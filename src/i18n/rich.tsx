import { Fragment, type ReactNode } from "react";

/**
 * A translated sentence with React nodes in it: `rich("Sent to {email}.", {
 * email: <b>{email}</b> })`. Translations keep the placeholder wherever their
 * grammar puts it, so a bold address or a link sits in the right spot in every
 * language instead of being glued on before or after the sentence.
 */
export function rich(template: string, nodes: Record<string, ReactNode>): ReactNode {
  const parts = template.split(/(\{[a-zA-Z0-9_]+\})/);
  return parts.map((part, index) => {
    const match = /^\{([a-zA-Z0-9_]+)\}$/.exec(part);
    if (match && match[1] in nodes) return <Fragment key={index}>{nodes[match[1]]}</Fragment>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}
