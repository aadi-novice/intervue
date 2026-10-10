import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RequireRole } from "@/components/require-role";
import { useAuthStore, type OrgRole } from "@/lib/auth-store";
import { CAN } from "@/lib/roles";

function setRole(role: OrgRole | null) {
  useAuthStore.setState({
    orgs: role ? [{ id: 1, name: "Acme", slug: "acme", role, settings: {} }] : [],
    currentOrgId: role ? 1 : null,
  });
}

describe("RequireRole", () => {
  beforeEach(() => setRole(null));

  it.each([
    ["admin", true],
    ["recruiter", true],
    ["hiring_manager", false],
    ["interviewer", false],
  ] as const)("create actions for %s -> visible=%s", (role, visible) => {
    setRole(role);
    render(
      <RequireRole roles={CAN.create} fallback={<span>nope</span>}>
        <button>New role</button>
      </RequireRole>,
    );
    expect(screen.queryByRole("button", { name: "New role" }) !== null).toBe(visible);
    expect(screen.queryByText("nope") !== null).toBe(!visible);
  });

  it("renders nothing without a current org", () => {
    const { container } = render(
      <RequireRole roles={CAN.moveStage}>
        <span>x</span>
      </RequireRole>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("reacts when the org (and therefore role) switches", () => {
    setRole("interviewer");
    render(
      <RequireRole roles={CAN.admin}>
        <span>admin only</span>
      </RequireRole>,
    );
    expect(screen.queryByText("admin only")).toBeNull();
    act(() => setRole("admin"));
    expect(screen.getByText("admin only")).toBeInTheDocument();
  });
});
