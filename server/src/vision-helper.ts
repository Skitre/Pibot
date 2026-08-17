import type { VisionHelperConfig } from "./model-profiles.js";

export async function describeImageWithHelper(
  helper: VisionHelperConfig,
  base64Image: string,
  mediaType = "image/png",
): Promise<string> {
  const base = helper.baseUrl.replace(/\/+$/, "");
  const instruction =
    "Describe this screenshot for a text-only agent operating the computer. Include: page/app title, visible text (verbatim where important), buttons/links/inputs with their labels, current state (errors, dialogs, focus), and layout. Be thorough but concise.";
  const timeout = AbortSignal.timeout(60_000);

  if (helper.api === "anthropic-messages") {
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": helper.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: helper.modelId,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
              { type: "text", text: instruction },
            ],
          },
        ],
      }),
      signal: timeout,
    });
    if (!res.ok) throw new Error(`vision helper HTTP ${res.status}`);
    const json: any = await res.json();
    return (json.content ?? [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }

  if (helper.api === "openai-responses") {
    const res = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${helper.apiKey}` },
      body: JSON.stringify({
        model: helper.modelId,
        input: [
          {
            role: "user",
            content: [
              { type: "input_image", image_url: `data:${mediaType};base64,${base64Image}` },
              { type: "input_text", text: instruction },
            ],
          },
        ],
      }),
      signal: timeout,
    });
    if (!res.ok) throw new Error(`vision helper HTTP ${res.status}`);
    const json: any = await res.json();
    if (typeof json.output_text === "string") return json.output_text;
    return (json.output ?? [])
      .flatMap((o: any) => o.content ?? [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("");
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${helper.apiKey}` },
    body: JSON.stringify({
      model: helper.modelId,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Image}` } },
            { type: "text", text: instruction },
          ],
        },
      ],
    }),
    signal: timeout,
  });
  if (!res.ok) throw new Error(`vision helper HTTP ${res.status}`);
  const json: any = await res.json();
  return json.choices?.[0]?.message?.content ?? "";
}
