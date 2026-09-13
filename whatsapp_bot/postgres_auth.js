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
        const data = {};
        await Promise.all(
          ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }),
        );
        return data;
      },

      set: async (data) => {
        const tasks = [];
        for (const category of Object.keys(data)) {
          const categoryData = data[category] || {};
          for (const id of Object.keys(categoryData)) {
            const value = categoryData[id];
            const key = `${category}-${id}`;
            tasks.push(value ? writeData(key, value) : removeData(key));
          }
        }
        await Promise.all(tasks);
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
