import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../tests/test-utils";
import Sidebar from "./leftnav";

vi.mock("../utils/roles", () => {
  return {
    all_admin_roles: ["admin"],
    internalUserRoles: ["internal"],
    rolesWithWriteAccess: ["admin", "internal"],
    isAdminRole: (role: string) => role === "admin",
    isUserTeamAdminForAnyTeam: () => false,
  };
});

const { mockUseAuthorized, mockUseOrganizations } = vi.hoisted(() => {
  const mockUseAuthorized = vi.fn(() => ({
    userId: "test-user-id",
    accessToken: "test-access-token",
    userRole: "admin",
    token: "test-token",
    userEmail: "test@example.com",
    premiumUser: false,
    disabledPersonalKeyCreation: false,
    showSSOBanner: false,
  }));

  const mockUseOrganizations = vi.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  }));

  return { mockUseAuthorized, mockUseOrganizations };
});

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: mockUseAuthorized,
}));

vi.mock("@/app/(dashboard)/hooks/organizations/useOrganizations", () => ({
  useOrganizations: mockUseOrganizations,
}));

vi.mock("@/app/(dashboard)/hooks/teams/useTeams", () => ({
  useTeams: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock("@/app/(dashboard)/hooks/uiConfig/useUIConfig", () => {
  return {
    useUIConfig: () => ({
      data: { admin_ui_disabled: false },
      isLoading: false,
    }),
  };
});

describe("Sidebar (leftnav)", () => {
  const defaultProps = {
    setPage: vi.fn(),
    defaultSelectedKey: "api-keys",
    collapsed: false,
  };

  it("renders all top-level (non-nested) tabs for admin", () => {
    renderWithProviders(<Sidebar {...defaultProps} />);

    const topLevelLabels = [
      "仮想キー",
      "プレイグラウンド",
      "モデル + エンドポイント",
      "エージェント",
      "MCPサーバー",
      "ガードレール",
      "ポリシー",
      "ツール",
      "使用状況",
      "ログ",
      "ガードレールモニター",
      "チーム",
      "内部ユーザー",
      "組織",
      "アクセスグループ",
      "予算",
      "APIリファレンス",
      "AIハブ",
      "学習リソース",
      "実験的機能",
      "設定",
    ];

    topLevelLabels.forEach((label) => {
      // Use getAllByText because some labels (e.g. "設定") appear as both
      // a group header and a menu item label in the sidebar
      const elements = screen.getAllByText(label);
      expect(elements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("expands a nested tab to reveal its children (Tools > Search Tools)", async () => {
    renderWithProviders(<Sidebar {...defaultProps} />);

    expect(screen.queryByText("検索ツール")).not.toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByText("ツール"));
    });
    await waitFor(() => {
      expect(screen.getByText("検索ツール")).toBeInTheDocument();
    });
  });
  it("has no duplicate keys among all menu items and their children", () => {
    // Helper to recursively extract all keys from Ant Design Menu items
    function getAllKeysFromMenu(wrapper: HTMLElement): string[] {
      const allKeys: string[] = [];
      // Ant Design renders key as data-menu-id or inside attributes, but for this case, we look for text as fallback.
      // For a generic check, here we fetch ids from rendered list items, and also descend into submenus
      const items = wrapper.querySelectorAll("[data-menu-id]");
      items.forEach((item) => {
        const dataMenuId = item.getAttribute("data-menu-id");
        if (dataMenuId) {
          allKeys.push(dataMenuId);
        }
      });
      return allKeys;
    }

    const { container } = renderWithProviders(<Sidebar {...defaultProps} />);
    const allRenderedKeys = getAllKeysFromMenu(container);

    const keySet = new Set<string>();
    const duplicates: string[] = [];
    for (const key of allRenderedKeys) {
      if (keySet.has(key)) {
        duplicates.push(key);
      }
      keySet.add(key);
    }
    expect(duplicates).toHaveLength(0);
  });

  it("should show Organizations tab for organization admins", () => {
    mockUseAuthorized.mockReturnValueOnce({
      userId: "org-admin-user-id",
      accessToken: "test-access-token",
      userRole: "viewer",
      token: "test-token",
      userEmail: "orgadmin@example.com",
      premiumUser: false,
      disabledPersonalKeyCreation: false,
      showSSOBanner: false,
    });

    mockUseOrganizations.mockReturnValueOnce({
      data: [
        {
          organization_id: "org-1",
          organization_name: "Test Organization",
          spend: 0,
          max_budget: null,
          models: [],
          tpm_limit: null,
          rpm_limit: null,
          members: [
            {
              user_id: "org-admin-user-id",
              user_role: "org_admin",
            },
          ],
        },
      ],
      isLoading: false,
      error: null,
    } as any);

    renderWithProviders(<Sidebar {...defaultProps} />);

    expect(screen.getByText("組織")).toBeInTheDocument();
  });
});
