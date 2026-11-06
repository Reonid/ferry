import {
  getIronSession,
  type IronSession,
  type SessionOptions,
} from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  accountId?: string;
}

/** 30 days, for both the cookie and the seal inside it (iron-session's own default is 14). */
const SESSION_TTL_S = 60 * 60 * 24 * 30;

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) {
    throw new Error(
      "SESSION_SECRET (32+ chars) is required for sessions — see .env.example",
    );
  }
  return {
    cookieName: "ferry_session",
    password,
    ttl: SESSION_TTL_S,
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_TTL_S,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}
