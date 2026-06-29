// ============================================================
//  OCR V2 — Single-file pipeline for JSAnywhere
//  Fields: name, id, dob, phone
//  Input:  odd images = personal info, even images = phone
// ============================================================

// ============================================================
// CONFIG
// ============================================================
const CONFIG = {
    DEBUG_LEVEL: 2,         // 0=off 1=result 2=raw+parsed 3=full OCR
    SHOW_PREVIEW: true,     // show crop previews in side panel

    THRESHOLD: {
        NAME:  120,
        ID:    170,
        DOB:   160,
        PHONE: 140
    },

    CROP: {
        // Proportional crop regions — tune per document layout
        NAME: {
            x: 0.15,
            y: 0.457,
            w: 0.7,
            h: 0.04
        },
        ID: {
            x: 0.58,
            y: 0.55,
            w: 0.32,
            h: 0.04
        },
        DOB: {
            x: 0.60,
            y: 0.49,
            w: 0.38,
            h: 0.05
        },
        PHONE: {
            x: 0.22,
            y: 0.38,
            w: 0.56,
            h: 0.07
        }
    },

    UPSCALE: {
        NAME:  4,
        ID:    4,
        DOB:   4,
        PHONE: 3
    }
};

// ============================================================
// DOM REFS  (set after DOMContentLoaded)
// ============================================================
let imageInput, startBtn, resultBox, progressEl, copyBtn, previewPanel, exportBtn;
let lastCustomers = []; // lưu kết quả để export

// ============================================================
// OCR WORKER (single, reused)
// ============================================================
let worker = null;

async function initWorker() {
    if (worker) return worker;
    worker = await Tesseract.createWorker();
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
    return worker;
}

// ============================================================
// MAIN PIPELINE
// ============================================================
async function runPipeline(files) {
    const customers = [];
    let errorCount = 0;
    const ocrWorker = await initWorker();

    // Pair up: odd index = personal, even index = phone
    for (let i = 0; i < files.length; i += 2) {
        const customerNum = Math.floor(i / 2) + 1;
        setProgress(`Đang xử lý khách ${customerNum}…`);

        const personalFile = files[i];
        const phoneFile    = files[i + 1];

        const customer = { name: "", id: "", dob: "", phone: "" };

        // --- Personal image ---
        if (personalFile) {
            try {
                const img = await loadImage(personalFile);

                customer.name = await ocrField(ocrWorker, img, "NAME", customerNum);
                customer.id   = await ocrField(ocrWorker, img, "ID",   customerNum);
                customer.dob  = await ocrField(ocrWorker, img, "DOB",  customerNum);
            } catch (e) {
                console.error(`[OCR V2] Khách ${customerNum} personal image failed:`, e);
                errorCount++;
            }
        }

        // --- Phone image ---
        if (phoneFile) {
            try {
                const img = await loadImage(phoneFile);
                customer.phone = await ocrField(ocrWorker, img, "PHONE", customerNum);
            } catch (e) {
                console.error(`[OCR V2] Khách ${customerNum} phone image failed:`, e);
                errorCount++;
            }
        }

        customers.push(customer);
        renderResults(customers);

        // Divider in preview
        if (CONFIG.SHOW_PREVIEW && previewPanel) {
            const div = document.createElement("div");
            div.style.cssText =
                "width:100%;border-top:1px solid #333;" +
                "margin:8px 0 4px;font-size:10px;color:#555;font-family:monospace";
            div.textContent = `— Khách ${customerNum} —`;
            previewPanel.appendChild(div);
        }
    }

    setProgress(`Hoàn thành ${customers.length} khách | Lỗi: ${errorCount}`);
    lastCustomers = customers;
    return customers;
}

// ============================================================
// OCR FIELD  — crop → preprocess → recognize → parse
// ============================================================
async function ocrField(ocrWorker, img, fieldType, customerNum) {
    const cropCanvas = cropImage(img, fieldType);

    const { data } = await ocrWorker.recognize(cropCanvas);

    const rawText = data.text;

    if (CONFIG.DEBUG_LEVEL >= 3) {
        console.log(`[OCR V2] Full OCR data (${fieldType}):`, data);
    }

    const parsed = parseField(rawText, fieldType);

    debugLog(customerNum, fieldType, rawText, parsed);

    return parsed;
}

// ============================================================
// CROP + PREPROCESS
// ============================================================
function cropImage(img, fieldType) {
    const canvas = document.createElement("canvas");
    const ctx    = canvas.getContext("2d");

    const w = img.width;
    const h = img.height;

    const c  = CONFIG.CROP[fieldType];
    const up = CONFIG.UPSCALE[fieldType];

    const cropX = w * c.x;
    const cropY = h * c.y;
    const cropW = w * c.w;
    const cropH = h * c.h;

    canvas.width  = cropW * up;
    canvas.height = cropH * up;

    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

    // Binarize
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d         = imageData.data;
    const threshold = CONFIG.THRESHOLD[fieldType];

    for (let i = 0; i < d.length; i += 4) {
        const avg   = (d[i] + d[i + 1] + d[i + 2]) / 3;
        const color = avg > threshold ? 255 : 0;
        d[i]     = color;
        d[i + 1] = color;
        d[i + 2] = color;
    }
    ctx.putImageData(imageData, 0, 0);

    if (CONFIG.SHOW_PREVIEW) {
        addPreview(canvas, fieldType);
    }

    return canvas;
}

// ============================================================
// PARSERS
// ============================================================
function parseField(raw, fieldType) {
    switch (fieldType) {
        case "NAME":  return parseName(raw);
        case "ID":    return parseId(raw);
        case "DOB":   return parseDob(raw);
        case "PHONE": return parsePhone(raw);
        default:      return "";
    }
}

// ---- NAME ----
function parseName(text) {
    let t = text
        // --- Tiếng Việt có dấu → không dấu (Tesseract đôi khi đọc được) ---
        .replace(/[ÀÁÂÃĂẶẮẰẲẴẤẦẨẪẬ]/g, "A")
        .replace(/[àáâãăặắằẳẵấầẩẫậ]/g, "a")
        .replace(/[ÈÉÊẸẺẼẾỀỂỄỆ]/g, "E")
        .replace(/[èéêẹẻẽếềểễệ]/g, "e")
        .replace(/[ÌÍỊỈĨ]/g, "I")
        .replace(/[ìíịỉĩ]/g, "i")
        .replace(/[ÒÓÔÕỌỎỐỒỔỖỘƠỚỜỞỠỢ]/g, "O")
        .replace(/[òóôõọỏốồổỗộơớờởỡợ]/g, "o")
        .replace(/[ÙÚŨỤỦƯỨỪỬỮỰ]/g, "U")
        .replace(/[ùúũụủưứừửữự]/g, "u")
        .replace(/[ỲÝỴỶỸ]/g, "Y")
        .replace(/[ỳýỵỷỹ]/g, "y")
        .replace(/[Đđ]/g, "D")
        // --- Fix nhầm ký tự phổ biến ---
        .replace(/0/g, "O")
        .replace(/1/g, "I")
        .replace(/\|/g, "I")
        .replace(/\//g, "I")
        .replace(/\\/g, "I")
        .replace(/\(/g, "C")
        .replace(/[)\{\}]/g, "")
        .replace(/\d/g, "")
        .replace(/[^A-Za-z ]/g, " ")
        .toUpperCase()
        // --- Fix lỗi cụ thể sau uppercase ---
        // Đ bị đọc thành P ở đầu từ (lỗi cố hữu Tesseract với font CCCD)
        .replace(/\bP(?=[AĂÂEÊIOÔƠUƯY])/g, "D")  // PO→DO, PA→DA, PU→DU...
        .replace(/\bPINH\b/g, "DINH")
        .replace(/\bL\b/g, "LE")
        .replace(/\s+/g, " ")
        .replace(/UG(?=[A-Z])/g, "UO")   // DUGNG→DUONG, CHUGNG→CHUONG
        .replace(/OGN(?=[A-Z])/g, "ON")   // TRUOGNG → TRUONG (biến thể Ư→OG)
        .replace(/\bUGN/g, "UON")          // UONG THI... → bắt đầu bằng UG
        .trim();

    return t || "";
}

// ---- ID (CCCD 12 or CMND 9) ----
function parseId(text) {
    let t = text
        .replace(/O/g, "0")
        .replace(/o/g, "0")
        .replace(/I/g, "1")
        .replace(/l/g, "1")
        .replace(/S/g, "5")
        .replace(/B/g, "8");

    const groups = t.match(/\d+/g);
    if (!groups) return "";

    const digits = groups.join("");

    if (digits.length === 12 || digits.length === 9) return digits;

    // Try substring match for 12-digit CCCD
    const m12 = digits.match(/\d{12}/);
    if (m12) return m12[0];

    const m9 = digits.match(/\d{9}/);
    if (m9) return m9[0];

    return "";
}

// ---- DOB ----
function parseDob(text) {
    let t = text
        .replace(/O/g, "0")
        .replace(/o/g, "0")
        .replace(/I/g, "1")
        .replace(/l/g, "1")
        .replace(/-/g, "/")
        .replace(/\./g, "/")
        .replace(/\s/g, "");

    // Match DD/MM/YYYY  or  D/M/YYYY  etc.
    const match = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return "";

    const day   = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const year  = parseInt(match[3], 10);

    if (day   < 1  || day   > 31)   return "";
    if (month < 1  || month > 12)   return "";
    if (year  < 1900 || year > 2100) return "";

    // Normalise to DD/MM/YYYY
    const dd = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `${dd}/${mm}/${year}`;
}

// ---- PHONE ----
function parsePhone(text) {
    const groups = text.match(/\d+/g);
    if (!groups) return "";

    const digits = groups.join("");

    // Standard Vietnamese mobile: 10 digits starting with 0
    if (digits.length === 10 && digits[0] === "0") return digits;

    // Old 11-digit format
    if (digits.length === 11 && digits[0] === "0") return digits;

    return "";
}

// ============================================================
// RENDER OUTPUT
// ============================================================
function renderResults(customers) {
    const lines = customers.map(c =>
        [c.phone, c.id, c.dob, c.name]
            .filter(Boolean)
            .join("\n")
    );
    resultBox.value = lines.join("\n\n");
}

// ============================================================
// DEBUG LOGGING
// ============================================================
function debugLog(customerNum, fieldType, raw, parsed) {
    if (CONFIG.DEBUG_LEVEL === 0) return;

    const border = "====================";

    if (CONFIG.DEBUG_LEVEL >= 1) {
        const status = parsed ? "OK" : "FAIL";

        if (CONFIG.DEBUG_LEVEL === 1) {
            console.log(`[Khách ${customerNum}][${fieldType}] ${status}: ${parsed}`);
            return;
        }

        // Level 2+
        console.log(
            `${border}\n` +
            `Khách ${customerNum}\n` +
            `TYPE: ${fieldType}\n\n` +
            `RAW:\n${raw.trim()}\n\n` +
            `PARSED:\n${parsed || "(empty)"}\n\n` +
            `STATUS:\n${status}\n` +
            `${border}`
        );
    }
}

// ============================================================
// PREVIEW PANEL
// ============================================================
function addPreview(canvas, fieldType) {
    // Show panel on first use
    previewPanel.style.display = "block";

    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-block;margin:4px 6px 4px 0;vertical-align:top";

    const label = document.createElement("div");
    label.textContent = fieldType;
    label.style.cssText = "font-size:10px;color:#888;margin-bottom:3px;font-family:monospace";

    const thumb = document.createElement("canvas");
    const thumbW = 160;
    thumb.width  = thumbW;
    thumb.height = Math.round(thumbW * canvas.height / canvas.width);
    thumb.getContext("2d").drawImage(canvas, 0, 0, thumb.width, thumb.height);
    thumb.style.cssText = "border:1px solid #e44;display:block;cursor:zoom-in;border-radius:3px";
    thumb.title = "Click để phóng to";

    thumb.addEventListener("click", () => {
        const overlay = document.createElement("div");
        overlay.style.cssText =
            "position:fixed;inset:0;background:rgba(0,0,0,.85);" +
            "display:flex;align-items:center;justify-content:center;" +
            "z-index:9999;cursor:zoom-out";
        const big = document.createElement("canvas");
        big.width  = canvas.width;
        big.height = canvas.height;
        big.getContext("2d").drawImage(canvas, 0, 0);
        big.style.cssText = "max-width:90vw;max-height:80vh;border-radius:4px";
        overlay.appendChild(big);
        overlay.addEventListener("click", () => overlay.remove());
        document.body.appendChild(overlay);
    });

    wrap.appendChild(label);
    wrap.appendChild(thumb);
    previewPanel.appendChild(wrap);
}

// ============================================================
// UTILITIES
// ============================================================
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload  = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

function setProgress(msg) {
    if (progressEl) progressEl.innerText = msg;
}

// ============================================================
// EXPORT EXCEL (SheetJS)
// ============================================================
function exportToExcel(customers) {
    console.log("[EXPORT] Bắt đầu export, số khách:", customers ? customers.length : 0);

    if (!customers || customers.length === 0) {
        alert("Chưa có dữ liệu để xuất");
        return;
    }

    // Kiểm tra SheetJS đã load chưa
    if (typeof XLSX === "undefined") {
        alert("SheetJS chưa load — kiểm tra kết nối mạng");
        console.error("[EXPORT] XLSX undefined");
        return;
    }
    console.log("[EXPORT] XLSX ok, tạo sheet...");

    const rows = customers.map((c, i) => ({
        "STT":       i + 1,
        "HỌ TÊN":   c.name  || "",
        "CCCD":      c.id    || "",
        "NGÀY SINH": c.dob   || "",
        "SĐT":       c.phone || ""
    }));
    console.log("[EXPORT] Rows:", rows);

    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
        { wch: 5  },
        { wch: 28 },
        { wch: 16 },
        { wch: 14 },
        { wch: 14 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Danh sách");
    console.log("[EXPORT] Workbook ok, ghi file...");

    try {
        // Thử writeFile trước
        const date = new Date();
        const stamp =
            `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,"0")}${String(date.getDate()).padStart(2,"0")}`;
        XLSX.writeFile(wb, `ho_so_${stamp}.xlsx`);
        console.log("[EXPORT] writeFile ok");
    } catch(e) {
        console.error("[EXPORT] writeFile thất bại:", e);
        // Fallback: tạo blob URL thủ công
        try {
            const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
            const blob  = new Blob([wbout], { type: "application/octet-stream" });
            const url   = URL.createObjectURL(blob);
            const a     = document.createElement("a");
            a.href      = url;
            a.download  = "ho_so.xlsx";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            console.log("[EXPORT] Blob fallback ok");
        } catch(e2) {
            console.error("[EXPORT] Blob fallback thất bại:", e2);
            alert("Không thể tải file — xem Console để biết lý do");
        }
    }
}

// ============================================================
// INIT UI
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    imageInput   = document.getElementById("imageInput");
    startBtn     = document.getElementById("startBtn");
    resultBox    = document.getElementById("result");
    progressEl   = document.getElementById("progress");
    copyBtn      = document.getElementById("copyBtn");
    exportBtn    = document.getElementById("exportBtn");

    exportBtn.addEventListener("click", () => exportToExcel(lastCustomers));

    // Preview panel — inline, not fixed
    previewPanel = document.getElementById("previewPanel");
    if (!previewPanel) {
        previewPanel = document.createElement("div");
        previewPanel.id = "previewPanel";
        const container = document.querySelector(".container") || document.body;
        container.appendChild(previewPanel);
    }
    previewPanel.style.cssText =
        "width:100%;margin-top:16px;background:#181818;" +
        "border:1px solid #2a2a2a;border-radius:8px;" +
        "padding:10px;display:none;max-height:320px;overflow-y:auto;";

    // Nút đóng — sticky top
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕ Đóng preview";
    closeBtn.style.cssText =
        "display:block;margin-left:auto;margin-bottom:8px;" +
        "background:#333;color:#aaa;border:none;border-radius:4px;" +
        "padding:3px 10px;font-size:11px;cursor:pointer;";
    closeBtn.addEventListener("click", () => {
        previewPanel.style.display = "none";
    });
    previewPanel.appendChild(closeBtn);

    startBtn.addEventListener("click", async () => {
        const files = [...imageInput.files];

        if (files.length === 0) {
            alert("Chọn ảnh trước");
            return;
        }

        if (files.length % 2 !== 0) {
            console.warn("[OCR V2] Số lượng ảnh lẻ — ảnh cuối sẽ thiếu số điện thoại");
        }

        // Clear previews (giữ lại nút đóng)
        if (previewPanel) {
            const keep = previewPanel.querySelector("button");
            previewPanel.innerHTML = "";
            if (keep) previewPanel.appendChild(keep);
        }

        resultBox.value = "";
        setProgress("Đang khởi động worker…");

        await runPipeline(files);
    });

    copyBtn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(resultBox.value);
        alert("Đã copy!");
    });
});
