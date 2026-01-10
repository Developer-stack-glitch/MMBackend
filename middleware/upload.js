import multer from "multer";
import path from "path";
import fs from "fs";

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join("uploads", "invoices");

        // 🔥 Auto create directory if missing
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }

        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, unique + path.extname(file.originalname));
    }
});


export const upload = multer({
    storage,
    limits: {
        fileSize: Infinity, // No file size limit
        files: 100 // Allow up to 100 files
    }
});

