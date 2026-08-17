import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText, MenuItem, useContextMenu } from "./ContextMenu";
import { useT } from "../i18n";

// 流式输出时未闭合的 ``` 会把后面整段吞进代码块，先补上再渲染。
function stabilizeFences(text: string): string {
  let open = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) open = !open;
  }
  return open ? `${text}\n\`\`\`\n` : text;
}

export function Markdown({ text }: { text: string }) {
  const { open } = useContextMenu();
  const tr = useT();
  const components: Components = {
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onContextMenu={(e) => {
          if (!href) return;
          open(
            e,
            <>
              <MenuItem onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>
                {tr("msg.openLink")}
              </MenuItem>
              <MenuItem onClick={() => copyText(href)}>{tr("msg.copyLink")}</MenuItem>
            </>,
          );
        }}
      >
        {children}
      </a>
    ),
    table: ({ children }) => (
      <div className="pibot-md__table-wrap">
        <table>{children}</table>
      </div>
    ),
  };
  return (
    <div className="pibot-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {stabilizeFences(text)}
      </ReactMarkdown>
    </div>
  );
}
