import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Button } from "./Button";
import { Card } from "./Card";

describe("base components", () => {
  it("renders a button with its label", () => {
    render(<Button>START</Button>);
    expect(screen.getByRole("button", { name: "START" })).toBeTruthy();
  });
  it("renders card children", () => {
    render(<Card><span>hi</span></Card>);
    expect(screen.getByText("hi")).toBeTruthy();
  });
});
