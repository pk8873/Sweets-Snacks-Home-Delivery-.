import { BufferJSON, initAuthCreds, proto } from "@whiskeysockets/baileys";

const TABLE = "whatsapp_auth_state";

export async function usePostgresAuthState(pool, sessionId) {
  if (!pool) throw new Error("PostgreSQL pool is required for WhatsApp auth state.");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT NOT NULL,
      state_key TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (session_id, state_key)
    )
  `);

  const keyFor = (key) => `${sessionId}:${key}`;

  const readData = async (key) => {
    const result = await pool.query(
      `SELECT data FROM ${TABLE} WHERE session_id = $1 AND state_key = $2 LIMIT 1`,
      [sessionId, key],
    );
    if (!result.rows.length) return null;

    try {
      return JSON.parse(result.rows[0].data, BufferJSON.reviver);
    } catch (error) {
      console.error(`Unable to decode WhatsApp auth state ${key}:`, error);
      return null;
    }
  };

  const writeData = async (key, value) => {
    const data = JSON.stringify(value, BufferJSON.replacer);
    await pool.query(
      `
        INSERT INTO ${TABLE} (session_id, state_key, data)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, state_key)
        DO UPDATE SET data = EXCLUDED.data
      `,
      [sessionId, key, data],
    );
  };

  const removeData = async (key) => {
    await pool.query(
      `DELETE FROM ${TABLE} WHERE session_id = $1 AND state_key = $2`,
      [sessionId, key],
    );
  };

  const creds = (await readData("creds")) || initAuthCreds();

  const state = {
    creds,
    keys: {
      get: async (type, ids) => {
        if (!ids?.length) return {};

        const stateKeys = ids.map((id) => `${type}-${id}`);
        const result = await pool.query(
          `SELECT state_key, data FROM ${TABLE} WHERE session_id = $1 AND state_key = ANY($2::text[])`,
          [sessionId, stateKeys],
        );
        const byKey = new Map(result.rows.map((row) => [row.state_key, row.data]));
        const data = {};

        for (const id of ids) {
          const key = `${type}-${id}`;
          const raw = byKey.get(key);
          if (raw == null) {
            data[id] = null;
            continue;
          }

          try {
            let value = JSON.parse(raw, BufferJSON.reviver);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          } catch (error) {
            console.error(`Unable to decode WhatsApp auth state ${key}:`, error);
            data[id] = null;
          }
        }

        return data;
      },

      set: async (data) => {
        const writes = [];
        const removals = [];

        for (const category of Object.keys(data || {})) {
          const categoryData = data[category] || {};
          for (const id of Object.keys(categoryData)) {
            const value = categoryData[id];
            const key = `${category}-${id}`;
            if (value) {
              writes.push([key, JSON.stringify(value, BufferJSON.replacer)]);
            } else {
              removals.push(key);
            }
          }
        }

        // Baileys can write hundreds of pre-keys at once. Do not issue one
        // PostgreSQL request per key: that exhausts the small Render/Supabase
        // pool and causes "failed to commit mutations" / pre-key upload timeouts.
        if (writes.length) {
          const values = [];
          const placeholders = writes.map(([key, value], index) => {
            const base = index * 3;
            values.push(sessionId, key, value);
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
          });

          await pool.query(
            `
              INSERT INTO ${TABLE} (session_id, state_key, data)
              VALUES ${placeholders.join(", ")}
              ON CONFLICT (session_id, state_key)
              DO UPDATE SET data = EXCLUDED.data
            `,
            values,
          );
        }

        if (removals.length) {
          await pool.query(
            `DELETE FROM ${TABLE} WHERE session_id = $1 AND state_key = ANY($2::text[])`,
            [sessionId, removals],
          );
        }
      },
    },
  };

  return {
    state,
    saveCreds: async () => writeData("creds", state.creds),
    deleteSession: async () => {
      await pool.query(`DELETE FROM ${TABLE} WHERE session_id = $1`, [sessionId]);
    },
    key: keyFor,
  };
}
