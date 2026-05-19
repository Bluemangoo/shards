import fs from "node:fs";
import axios, { AxiosError } from "axios";

const META_URL =
    "https://raw.githubusercontent.com/koishijs/QFace/refs/heads/master/public/assets/qq_emoji/_index.json";

export type Face = {
    emojiId: string;
    describe: string;
    qzoneCode: string;
    qcid: number;
    emojiType: number;
    aniStickerPackId: number;
    aniStickerId: number;
    isHide: boolean;
    startTime: string;
    endTime: string;
    animationWidth: number;
    animationHeigh: number;
    assets: {
        type: number;
        name: string;
        path: string;
    }[];
};

const faces = new Map<string, Face>();

export async function initFace() {
    let needAwait = !fs.existsSync(process.cwd() + "/data/qface.json");
    if (!needAwait) {
        try {
            const str = fs.readFileSync(process.cwd() + "/data/qface.json").toString();
            loadFaceMeta(JSON.parse(str));
        } catch {
            needAwait = true;
        }
    }
    const task = downloadFaceMeta();
    if (needAwait) {
        await task;
    } else {
        task.catch((e) => {
            let error = e;
            if (error instanceof AxiosError) {
                error = error.cause;
            }
            console.warn("Failed to update qface meta", error);
        });
    }
}

async function downloadFaceMeta() {
    fs.mkdirSync(process.cwd() + "/data", { recursive: true });
    const resp = await axios.get(META_URL);
    const data = resp.data as Face[];
    loadFaceMeta(data);
    fs.writeFileSync(process.cwd() + "/data/qface.json", JSON.stringify(data));
}

function loadFaceMeta(face: Face[]) {
    for (const f of face) {
        faces.set(f.emojiId, f);
    }
}

export function getFace(emojiId: string): Face | undefined {
    return faces.get(emojiId);
}
