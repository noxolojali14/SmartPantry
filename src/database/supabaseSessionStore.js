import session from "express-session";

export class SupabaseSessionStore extends session.Store {
  constructor(supabase) {
    super();
    this.supabase = supabase;
  }

  get(sid, callback) {
    this.supabase
      .from("sessions")
      .select("sess, expires_at")
      .eq("sid", sid)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error) return callback(error);
        if (!data) return callback(null, null);
        if (new Date(data.expires_at).getTime() <= Date.now()) {
          const result = await this.supabase.from("sessions").delete().eq("sid", sid);
          if (result.error) return callback(result.error);
          return callback(null, null);
        }
        callback(null, data.sess);
      })
      .catch(callback);
  }

  set(sid, value, callback = () => {}) {
    const cookieExpiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : 0;
    const expiresAt = cookieExpiry || Date.now() + (value.cookie?.originalMaxAge ?? 86400000);
    this.supabase
      .from("sessions")
      .upsert({ sid, sess: value, expires_at: new Date(expiresAt).toISOString() }, { onConflict: "sid" })
      .then(({ error }) => callback(error || null))
      .catch(callback);
  }

  touch(sid, value, callback = () => {}) {
    const cookieExpiry = value.cookie?.expires ? new Date(value.cookie.expires).getTime() : 0;
    const expiresAt = cookieExpiry || Date.now() + (value.cookie?.originalMaxAge ?? 86400000);
    this.supabase
      .from("sessions")
      .update({ expires_at: new Date(expiresAt).toISOString() })
      .eq("sid", sid)
      .then(({ error }) => callback(error || null))
      .catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.supabase
      .from("sessions")
      .delete()
      .eq("sid", sid)
      .then(({ error }) => callback(error || null))
      .catch(callback);
  }
}