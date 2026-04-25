import axios from "axios";
import mime from "mime-types";
import path from "node:path";
import fs from "node:fs";

export async function urlToDataUrl(url: string): Promise<string> {
    const response = await axios.get(url, { responseType: "arraybuffer" });

    const contentType = response.headers["content-type"] || guessMimeFromUrl(url);

    const base64 = Buffer.from(response.data, "binary").toString("base64");

    return `data:${contentType};base64,${base64}`;
}

function guessMimeFromUrl(url: string): string {
    const type = mime.lookup(url);

    return type || "application/octet-stream";
}

export async function downloadFileWithAutoExt(
    url: string,
    baseFileName: string,
    outputDir: string,
): Promise<string> {
    try {
        const response = await axios({
            method: "GET",
            url: url,
            responseType: "stream",
        });

        let ext = "";

        const contentDisposition = response.headers["content-disposition"];
        if (contentDisposition) {
            const filenameMatch = contentDisposition.match(
                /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/,
            );
            if (filenameMatch && filenameMatch[1]) {
                const originalName = filenameMatch[1].replace(/['"]/g, "");
                ext = path.extname(originalName);
            }
        }
        const contentType = response.headers["content-type"];
        if (!ext) {
            if (contentType) {
                // mime.extension 会根据 'image/jpeg' 返回 'jpeg'
                const mimeExt = mime.extension(String(contentType));
                if (mimeExt) {
                    ext = `.${mimeExt}`;
                }
            }
        }

        if (!ext) {
            ext = ".bin";
        }

        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const finalFileName = `${baseFileName}${ext}`;
        const destPath = path.join(outputDir, finalFileName);

        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on("finish", () => resolve(finalFileName));
            writer.on("error", (err) => {
                fs.unlink(destPath, () => {});
                reject(err);
            });
        });
    } catch (error) {
        console.error(`下载失败: ${url}`, error);
        throw error;
    }
}
