import fs from "node:fs";
import db from "./db.ts";
import { downloadFileWithAutoExt } from "../../utils/net.ts";
import { imageModel } from "../../model/image_model.ts";
import { napcat } from "../../napcat/client.ts";

export interface ImageDescriptionData {
    id: number; // <-- 新增的 description id
    summary: string;
    description: string;
    tags: string[];
}

export interface StickerResult {
    id: number;
    file_id: string;
    file_name: string;
    created_at: Date;
    description_data: ImageDescriptionData;
}

class Sticker {
    async getOrCreateDescription(
        fileId: string,
        url: string,
    ): Promise<ImageDescriptionData | null> {
        const exist = await this.findImageDescriptionByFileId(fileId);
        if (exist) {
            return exist;
        }
        let fileName;
        try {
            fileName = await downloadFileWithAutoExt(
                url,
                fileId.split(".")[0],
                process.cwd() + "/data/temp_stickers",
            );
        } catch (e) {
            const f = await napcat.get_image({ file: fileId });
            fileName = f.file_name;
            fs.copyFileSync(f.file, process.cwd() + "/data/temp_stickers" + "/" + f.file_name);
        }
        const ext = fileName.split(".").pop()!;
        const b64 = fs.readFileSync(process.cwd() + "/data/temp_stickers/" + fileName, {
            encoding: "base64",
        });
        const dataUrl = "data:image/" + ext + ";base64," + b64;
        const descriptionData = await imageModel.parseImage(dataUrl);
        if (!descriptionData) {
            return null;
        }

        // 获取插入后返回的 descriptionId
        const descriptionId = await this.addImageDescription(
            fileId,
            descriptionData.summary,
            descriptionData.description,
            descriptionData.tags,
        );

        // 组装包含 id 的完整数据返回
        return {
            id: descriptionId,
            summary: descriptionData.summary,
            description: descriptionData.description,
            tags: descriptionData.tags,
        };
    }

    async addImageDescription(
        fileId: string,
        summary: string,
        description: string,
        tags: string[],
    ): Promise<number> {
        try {
            await db().query("BEGIN");

            const descRes = await db().query(
                `INSERT INTO image_description (summary, description) 
             VALUES ($1, $2) RETURNING id`,
                [summary, description],
            );
            const descriptionId = descRes.rows[0].id;

            await db().query(
                `INSERT INTO file_id_description (file_id, description_id) 
             VALUES ($1, $2)`,
                [fileId, descriptionId],
            );

            for (const tag of tags) {
                let tagRes = await db().query(`SELECT id FROM image_tag WHERE tag = $1`, [tag]);
                let tagId: number;

                if (tagRes.rows.length > 0) {
                    tagId = tagRes.rows[0].id;
                } else {
                    const insertTagRes = await db().query(
                        `INSERT INTO image_tag (tag) VALUES ($1) RETURNING id`,
                        [tag],
                    );
                    tagId = insertTagRes.rows[0].id;
                }

                await db().query(
                    `INSERT INTO image_description_tag (description_id, tag_id) 
                 VALUES ($1, $2)`,
                    [descriptionId, tagId],
                );
            }

            await db().query("COMMIT");
            return descriptionId;
        } catch (error) {
            await db().query("ROLLBACK");
            throw error;
        }
    }

    async findImageDescriptionByFileId(fileId: string): Promise<ImageDescriptionData | null> {
        const sql = `
        SELECT 
            d.id,  -- <-- 查询 d.id
            d.summary, 
            d.description,
            COALESCE(json_agg(t.tag) FILTER (WHERE t.tag IS NOT NULL), '[]') AS tags
        FROM file_id_description fd
        JOIN image_description d ON fd.description_id = d.id
        LEFT JOIN image_description_tag dt ON d.id = dt.description_id
        LEFT JOIN image_tag t ON dt.tag_id = t.id
        WHERE fd.file_id = $1
        GROUP BY d.id
    `;

        const res = await db().query(sql, [fileId]);

        if (res.rows.length === 0) return null;

        return {
            id: res.rows[0].id, // <-- 映射 id
            summary: res.rows[0].summary,
            description: res.rows[0].description,
            tags: res.rows[0].tags,
        };
    }

    async addSticker(descriptionId: number, fileId: string, fileName: string): Promise<number> {
        const sql = `
        INSERT INTO sticker (description_id, file_id, file_name)
        VALUES ($1, $2, $3)
        RETURNING id
    `;
        const res = await db().query(sql, [descriptionId, fileId, fileName]);
        return res.rows[0].id;
    }

    async getSticker(id: number): Promise<StickerResult | null> {
        const sql = `
            WITH AggregatedTags AS (SELECT dt.description_id,
                                           json_agg(t.tag) AS tags
                                    FROM image_description_tag dt
                                             JOIN image_tag t ON dt.tag_id = t.id
                                    GROUP BY dt.description_id)
            SELECT s.id                          AS sticker_id,
                   s.file_id,
                   s.file_name,
                   s.created_at,
                   d.id                          AS description_id, -- <-- 查询 description_id
                   d.summary,
                   d.description,
                   COALESCE(at.tags, '[]'::json) AS tags
            FROM sticker s
                     JOIN image_description d ON s.description_id = d.id
                     LEFT JOIN AggregatedTags at ON d.id = at.description_id
            WHERE s.id = $1
        `;

        const res = await db().query(sql, [id]);

        if (res.rows.length === 0) {
            return null;
        }

        const row = res.rows[0];
        return {
            id: row.sticker_id,
            file_id: row.file_id,
            file_name: row.file_name,
            created_at: row.created_at,
            description_data: {
                id: row.description_id, // <-- 映射 id
                summary: row.summary,
                description: row.description,
                tags: row.tags,
            },
        };
    }

    async listStickers(): Promise<StickerResult[]> {
        const sql = `
            WITH AggregatedTags AS (SELECT dt.description_id,
                                           json_agg(t.tag) AS tags
                                    FROM image_description_tag dt
                                             JOIN image_tag t ON dt.tag_id = t.id
                                    GROUP BY dt.description_id)
            SELECT s.id                          AS sticker_id,
                   s.file_id,
                   s.file_name,
                   s.created_at,
                   d.id                          AS description_id, -- <-- 查询 description_id
                   d.summary,
                   d.description,
                   COALESCE(at.tags, '[]'::json) AS tags
            FROM sticker s
                     JOIN image_description d ON s.description_id = d.id
                     LEFT JOIN AggregatedTags at ON d.id = at.description_id
            ORDER BY s.created_at DESC
        `;

        const res = await db().query(sql);

        return res.rows.map((row: any) => ({
            id: row.sticker_id,
            file_id: row.file_id,
            file_name: row.file_name,
            created_at: row.created_at,
            description_data: {
                id: row.description_id, // <-- 映射 id
                summary: row.summary,
                description: row.description,
                tags: row.tags,
            },
        }));
    }

    async updateStickerFileId(id: number, oldFileId: string, newFileId: string): Promise<boolean> {
        try {
            await db().query("BEGIN");

            const updateRes = await db().query(
                `UPDATE sticker 
                 SET file_id = $1 
                 WHERE id = $2 AND file_id = $3`,
                [newFileId, id, oldFileId],
            );

            if (updateRes.rowCount === 0) {
                await db().query("ROLLBACK");
                return false;
            }

            await db().query(
                `INSERT INTO file_id_description (file_id, description_id)
                 SELECT $1, description_id 
                 FROM file_id_description 
                 WHERE file_id = $2
                 ON CONFLICT DO NOTHING`,
                [newFileId, oldFileId],
            );

            await db().query("COMMIT");
            return true;
        } catch (error) {
            await db().query("ROLLBACK");
            throw error;
        }
    }

    async findStickersWithFileId(fileId: string): Promise<number[]> {
        const sql = `select id from sticker where file_id = $1`;
        const result = await db().query(sql, [fileId]);
        return result.rows.map((row: any) => row.id);
    }
}

// 确保目录存在，这里稍微修复了原代码中创建 tickers 目录名拼写错误的问题，改为 stickers
fs.mkdirSync(process.cwd() + "/data/temp_stickers", { recursive: true });
fs.mkdirSync(process.cwd() + "/data/stickers", { recursive: true });

const sticker = new Sticker();
export { sticker };
