// Tiny dependency-free multipart/form-data encoder for the verify scripts (so app.inject() can post
// a real multipart body to /agents/create without pulling an extra dependency).
export interface MultipartField {
  name: string;
  value?: string; // text field
  filename?: string; // file field
  contentType?: string; // file field
  data?: Buffer; // file field
}

export function encodeMultipart(fields: MultipartField[]): { body: Buffer; headers: Record<string, string> } {
  const boundary = "----auraVerify" + Math.random().toString(16).slice(2);
  const CRLF = "\r\n";
  const chunks: Buffer[] = [];
  for (const f of fields) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}`, "utf8"));
    if (f.filename && f.data) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${f.name}"; filename="${f.filename}"${CRLF}` +
            `Content-Type: ${f.contentType ?? "application/octet-stream"}${CRLF}${CRLF}`,
          "utf8",
        ),
      );
      chunks.push(f.data);
      chunks.push(Buffer.from(CRLF, "utf8"));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${f.name}"${CRLF}${CRLF}`, "utf8"));
      chunks.push(Buffer.from(`${f.value ?? ""}${CRLF}`, "utf8"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, "utf8"));
  const body = Buffer.concat(chunks);
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
