export async function verifyQstash(
  req: Request,
  receiver: {
    verify(args: { signature: string; body: string }): Promise<boolean>;
  },
): Promise<string | null> {
  const signature = req.headers.get("upstash-signature");
  if (!signature) return null;
  const body = await req.text();
  try {
    return (await receiver.verify({ signature, body })) ? body : null;
  } catch {
    return null;
  }
}
