import { WebClient } from "@slack/web-api";
import crypto from "crypto";

export const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export function verifySlackSignature(
  rawBody: string,
  signature: string,
  timestamp: string
): boolean {
  // 5分以上前のリクエストはリプレイアタック対策で拒否
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", process.env.SLACK_SIGNING_SECRET!)
    .update(baseString)
    .digest("hex");

  return `v0=${hmac}` === signature;
}
