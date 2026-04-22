import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownContent } from "@/components/home/MarkdownContent";

describe("MarkdownContent", () => {
  it("preserves newline formatting for markdown text blocks", () => {
    const { container } = render(<MarkdownContent>{"Line one\nLine two"}</MarkdownContent>);

    expect(container.firstChild).toHaveClass("whitespace-pre-wrap");
    expect(container.textContent).toContain("Line one");
    expect(container.textContent).toContain("Line two");
  });
});
