import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import { useTeams } from "@/app/(dashboard)/hooks/teams/useTeams";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { useTranslation } from "@/i18n";
import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  BlockOutlined,
  BookOutlined,
  CreditCardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  FolderOutlined,
  KeyOutlined,
  LineChartOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  SafetyOutlined,
  SearchOutlined,
  SettingOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { ConfigProvider, Layout, Menu } from "antd";
import { useMemo } from "react";
import { all_admin_roles, internalUserRoles, isAdminRole, isUserTeamAdminForAnyTeam, rolesWithWriteAccess } from "../utils/roles";
import NewBadge from "./common_components/NewBadge";
import type { Organization } from "./networking";
import UsageIndicator from "./UsageIndicator";
const { Sider } = Layout;

// Define the props type
interface SidebarProps {
  setPage: (page: string) => void;
  defaultSelectedKey: string;
  collapsed?: boolean;
  enabledPagesInternalUsers?: string[] | null;
  enableProjectsUI?: boolean;
  disableAgentsForInternalUsers?: boolean;
  allowAgentsForTeamAdmins?: boolean;
  disableVectorStoresForInternalUsers?: boolean;
  allowVectorStoresForTeamAdmins?: boolean;
}

// Menu item configuration
interface MenuItem {
  key: string;
  page: string;
  label: string | React.ReactNode;
  roles?: string[];
  children?: MenuItem[];
  icon?: React.ReactNode;
  external_url?: string;
}

// Group configuration
interface MenuGroup {
  groupLabel: string;
  items: MenuItem[];
  roles?: string[];
}

// Menu groups organized by category - factory function for i18n support
function createMenuGroups(t: (key: string) => string): MenuGroup[] {
  return [
    {
      groupLabel: t("nav.groups.aiGateway"),
      items: [
        {
          key: "api-keys",
          page: "api-keys",
          label: t("nav.items.virtualKeys"),
          icon: <KeyOutlined />,
        },
        {
          key: "llm-playground",
          page: "llm-playground",
          label: t("nav.items.playground"),
          icon: <PlayCircleOutlined />,
          roles: rolesWithWriteAccess,
        },
        {
          key: "models",
          page: "models",
          label: t("nav.items.modelsEndpoints"),
          icon: <BlockOutlined />,
          roles: rolesWithWriteAccess,
        },
        {
          key: "agents",
          page: "agents",
          label: t("nav.items.agents"),
          icon: <RobotOutlined />,
          roles: rolesWithWriteAccess,
        },
        {
          key: "mcp-servers",
          page: "mcp-servers",
          label: t("nav.items.mcpServers"),
          icon: <ToolOutlined />,
        },
        {
          key: "guardrails",
          page: "guardrails",
          label: t("nav.items.guardrails"),
          icon: <SafetyOutlined />,
          roles: all_admin_roles,
        },
        {
          key: "policies",
          page: "policies",
          label: (
            <span className="flex items-center gap-4">
              {t("nav.items.policies")}
            </span>
          ),
          icon: <AuditOutlined />,
          roles: all_admin_roles,
        },
        {
          key: "tools",
          page: "tools",
          label: t("nav.items.tools"),
          icon: <ToolOutlined />,
          children: [
            {
              key: "search-tools",
              page: "search-tools",
              label: t("nav.items.searchTools"),
              icon: <SearchOutlined />,
            },
            {
              key: "vector-stores",
              page: "vector-stores",
              label: t("nav.items.vectorStores"),
              icon: <DatabaseOutlined />,
            },
            {
              key: "tool-policies",
              page: "tool-policies",
              label: t("nav.items.toolPolicies"),
              icon: <SafetyOutlined />,
            },
          ],
        },
      ],
    },
    {
      groupLabel: t("nav.groups.observability"),
      items: [
        {
          key: "new_usage",
          page: "new_usage",
          icon: <BarChartOutlined />,
          roles: [...all_admin_roles, ...internalUserRoles],
          label: t("nav.items.usage"),
        },
        {
          key: "logs",
          page: "logs",
          label: t("nav.items.logs"),
          icon: <LineChartOutlined />,
        },
        {
          key: "guardrails-monitor",
          page: "guardrails-monitor",
          label: t("nav.items.guardrailsMonitor"),
          icon: <SafetyOutlined />,
          roles: [...all_admin_roles, ...internalUserRoles],
        },
      ],
    },
    {
      groupLabel: t("nav.groups.accessControl"),
      items: [
        {
          key: "teams",
          page: "teams",
          label: t("nav.items.teams"),
          icon: <TeamOutlined />,
        },
        {
          key: "projects",
          page: "projects",
          label: (
            <span className="flex items-center gap-2">
              {t("nav.items.projects")} <NewBadge />
            </span>
          ),
          icon: <FolderOutlined />,
          roles: all_admin_roles,
        },
        {
          key: "users",
          page: "users",
          label: t("nav.items.internalUsers"),
          icon: <UserOutlined />,
          roles: all_admin_roles,
        },
        {
          key: "organizations",
          page: "organizations",
          label: t("nav.items.organizations"),
          icon: <BankOutlined />,
          roles: all_admin_roles,
        },
        {
          key: "access-groups",
          page: "access-groups",
          label: t("nav.items.accessGroups"),
          icon: <BlockOutlined />,
          roles: all_admin_roles,
        },
        {
          key: "budgets",
          page: "budgets",
          label: t("nav.items.budgets"),
          icon: <CreditCardOutlined />,
          roles: all_admin_roles,
        },
      ],
    },
    {
      groupLabel: t("nav.groups.developerTools"),
      items: [
        {
          key: "api_ref",
          page: "api_ref",
          label: t("nav.items.apiReference"),
          icon: <ApiOutlined />,
        },
        {
          key: "model-hub-table",
          page: "model-hub-table",
          label: t("nav.items.aiHub"),
          icon: <AppstoreOutlined />,
        },
        {
          key: "learning-resources",
          page: "learning-resources",
          label: t("nav.items.learningResources"),
          icon: <BookOutlined />,
          external_url: "https://models.litellm.ai/cookbook",
        },
        {
          key: "experimental",
          page: "experimental",
          label: t("nav.items.experimental"),
          icon: <ExperimentOutlined />,
          children: [
            {
              key: "caching",
              page: "caching",
              label: t("nav.items.caching"),
              icon: <DatabaseOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "prompts",
              page: "prompts",
              label: t("nav.items.prompts"),
              icon: <FileTextOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "transform-request",
              page: "transform-request",
              label: t("nav.items.apiPlayground"),
              icon: <ApiOutlined />,
              roles: [...all_admin_roles, ...internalUserRoles],
            },
            {
              key: "tag-management",
              page: "tag-management",
              label: t("nav.items.tagManagement"),
              icon: <TagsOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "claude-code-plugins",
              page: "claude-code-plugins",
              label: t("nav.items.claudeCodePlugins"),
              icon: <ToolOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "4",
              page: "usage",
              label: t("nav.items.oldUsage"),
              icon: <BarChartOutlined />,
            }
          ],
        },
      ],
    },
    {
      groupLabel: t("nav.groups.settings"),
      roles: all_admin_roles,
      items: [
        {
          key: "settings",
          page: "settings",
          label: (
            <span className="flex items-center gap-2">
              {t("common.settings")} <NewBadge />
            </span>
          ),
          icon: <SettingOutlined />,
          roles: all_admin_roles,
          children: [
            {
              key: "router-settings",
              page: "router-settings",
              label: t("nav.items.routerSettings"),
              icon: <SettingOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "logging-and-alerts",
              page: "logging-and-alerts",
              label: t("nav.items.loggingAlerts"),
              icon: <SettingOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "admin-panel",
              page: "admin-panel",
              label: (
                <span className="flex items-center gap-2">
                  {t("nav.items.adminSettings")} <NewBadge dot><span /></NewBadge>
                </span>
              ),
              icon: <SettingOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "cost-tracking",
              page: "cost-tracking",
              label: t("nav.items.costTracking"),
              icon: <BarChartOutlined />,
              roles: all_admin_roles,
            },
            {
              key: "ui-theme",
              page: "ui-theme",
              label: t("nav.items.uiTheme"),
              icon: <BgColorsOutlined />,
              roles: all_admin_roles,
            },
          ],
        },
      ],
    },
  ];
}

// Keep backward-compatible export (English defaults)
const menuGroups: MenuGroup[] = createMenuGroups((key: string) => {
  // Fallback: return the last segment of the key as-is for backward compat
  const parts = key.split(".");
  return parts[parts.length - 1];
});

const Sidebar: React.FC<SidebarProps> = ({ setPage, defaultSelectedKey, collapsed = false, enabledPagesInternalUsers, enableProjectsUI, disableAgentsForInternalUsers, allowAgentsForTeamAdmins, disableVectorStoresForInternalUsers, allowVectorStoresForTeamAdmins }) => {
  const { userId, accessToken, userRole } = useAuthorized();
  const { data: organizations } = useOrganizations();
  const { data: teams } = useTeams();
  const { t } = useTranslation();

  // Create translated menu groups
  const translatedMenuGroups = useMemo(() => createMenuGroups(t), [t]);

  // Check if user is an org_admin
  const isOrgAdmin = useMemo(() => {
    if (!userId || !organizations) return false;
    return organizations.some((org: Organization) =>
      org.members?.some((member) => member.user_id === userId && member.user_role === "org_admin"),
    );
  }, [userId, organizations]);

  // Check if user is a team admin for any team
  const isTeamAdmin = useMemo(() => isUserTeamAdminForAnyTeam(teams ?? null, userId ?? ""), [teams, userId]);

  // Navigate to page helper
  const navigateToPage = (page: string) => {
    const newSearchParams = new URLSearchParams(window.location.search);
    newSearchParams.set("page", page);
    window.history.pushState(null, "", `?${newSearchParams.toString()}`);
    setPage(page);
  };

  // Wrap label in <a> so every nav item supports right-click → "Open in new tab"
  // and Ctrl/Cmd+click to open in a new tab, while preserving SPA navigation for normal clicks.
  const renderNavLink = (
    label: React.ReactNode,
    page: string,
    externalUrl?: string,
  ): React.ReactNode => {
    if (externalUrl) {
      return (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{ color: "inherit", textDecoration: "none" }}
        >
          {label}
        </a>
      );
    }
    const params = new URLSearchParams(window.location.search);
    params.set("page", page);
    const href = `?${params.toString()}`;
    return (
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
            e.stopPropagation();
            return;
          }
          e.preventDefault();
        }}
        style={{ color: "inherit", textDecoration: "none" }}
      >
        {label}
      </a>
    );
  };

  // Filter items based on user role and enabled pages for internal users
  const filterItemsByRole = (items: MenuItem[]): MenuItem[] => {
    const isAdmin = isAdminRole(userRole);

    // Debug logging
    if (enabledPagesInternalUsers !== null && enabledPagesInternalUsers !== undefined) {
      console.log("[LeftNav] Filtering with enabled pages:", {
        userRole,
        isAdmin,
        enabledPagesInternalUsers,
      });
    }

    return items
      .map((item) => ({
        ...item,
        children: item.children ? filterItemsByRole(item.children) : undefined,
      }))
      .filter((item) => {
        // Special handling for organizations menu item - allow org_admins
        if (item.key === "organizations") {
          const hasRoleAccess = !item.roles || item.roles.includes(userRole) || isOrgAdmin;
          if (!hasRoleAccess) return false;

          // Check enabled pages for internal users (non-admins)
          if (!isAdmin && enabledPagesInternalUsers !== null && enabledPagesInternalUsers !== undefined) {
            const isIncluded = enabledPagesInternalUsers.includes(item.page);
            console.log(`[LeftNav] Page "${item.page}" (${item.key}): ${isIncluded ? "VISIBLE" : "HIDDEN"}`);
            return isIncluded;
          }
          return true;
        }

        // Hide Projects page if enableProjectsUI is not enabled
        if (item.key === "projects" && !enableProjectsUI) return false;

        // Hide agents and vector-stores pages for non-admin users when disabled,
        // unless allow_*_for_team_admins is on and the user is a team admin.
        if (!isAdmin && item.key === "agents" && disableAgentsForInternalUsers && !(allowAgentsForTeamAdmins && isTeamAdmin)) return false;
        if (!isAdmin && item.key === "vector-stores" && disableVectorStoresForInternalUsers && !(allowVectorStoresForTeamAdmins && isTeamAdmin)) return false;

        // Existing role check
        if (item.roles && !item.roles.includes(userRole)) return false;

        // Check enabled pages for internal users (non-admins)
        if (!isAdmin && enabledPagesInternalUsers !== null && enabledPagesInternalUsers !== undefined) {
          // If item has children, check if any children are visible
          if (item.children && item.children.length > 0) {
            const hasVisibleChildren = item.children.some((child) =>
              enabledPagesInternalUsers.includes(child.page)
            );
            if (hasVisibleChildren) {
              console.log(`[LeftNav] Parent "${item.page}" (${item.key}): VISIBLE (has visible children)`);
              return true;
            }
          }

          const isIncluded = enabledPagesInternalUsers.includes(item.page);
          console.log(`[LeftNav] Page "${item.page}" (${item.key}): ${isIncluded ? "VISIBLE" : "HIDDEN"}`);
          return isIncluded;
        }

        return true;
      });
  };

  // Build menu items with groups
  const buildMenuItems = (): MenuProps["items"] => {
    const items: MenuProps["items"] = [];

    translatedMenuGroups.forEach((group) => {
      // Check if group has role restriction
      if (group.roles && !group.roles.includes(userRole)) {
        return;
      }

      const filteredItems = filterItemsByRole(group.items);
      if (filteredItems.length === 0) return;

      // Add group with items
      items.push({
        type: "group",
        label: collapsed ? null : (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: "#6b7280",
              letterSpacing: "0.05em",
              padding: "12px 0 4px 12px",
              display: "block",
              marginBottom: "2px",
            }}
          >
            {group.groupLabel}
          </span>
        ),
        children: filteredItems.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: renderNavLink(item.label, item.page, item.external_url),
          children: item.children?.map((child) => ({
            key: child.key,
            icon: child.icon,
            label: renderNavLink(child.label, child.page, child.external_url),
            onClick: () => {
              if (child.external_url) {
                window.open(child.external_url, "_blank");
              } else {
                navigateToPage(child.page);
              }
            },
          })),
          onClick: !item.children
            ? () => {
              if (item.external_url) {
                window.open(item.external_url, "_blank");
              } else {
                navigateToPage(item.page);
              }
            }
            : undefined,
        })),
      });
    });

    return items;
  };

  // Find selected menu key
  const findMenuItemKey = (page: string): string => {
    for (const group of translatedMenuGroups) {
      for (const item of group.items) {
        if (item.page === page) return item.key;
        if (item.children) {
          const child = item.children.find((c) => c.page === page);
          if (child) return child.key;
        }
      }
    }
    return "api-keys";
  };

  const selectedMenuKey = findMenuItemKey(defaultSelectedKey);

  return (
    <Layout>
      <Sider
        theme="light"
        width={220}
        collapsed={collapsed}
        collapsedWidth={80}
        collapsible
        trigger={null}
        style={{
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          position: "relative",
        }}
      >
        <ConfigProvider
          theme={{
            components: {
              Menu: {
                iconSize: 15,
                fontSize: 13,
                itemMarginInline: 4,
                itemPaddingInline: 8,
                itemHeight: 30,
                itemBorderRadius: 6,
                subMenuItemBorderRadius: 6,
                groupTitleFontSize: 10,
                groupTitleLineHeight: 1.5,
              },
            },
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedMenuKey]}
            defaultOpenKeys={[]}
            inlineCollapsed={collapsed}
            className="custom-sidebar-menu"
            style={{
              borderRight: 0,
              backgroundColor: "transparent",
              fontSize: "13px",
              paddingTop: "4px",
            }}
            items={buildMenuItems()}
          />
        </ConfigProvider>
        {isAdminRole(userRole) && !collapsed && <UsageIndicator accessToken={accessToken} width={220} />}
      </Sider>
    </Layout>
  );
};

export default Sidebar;

// Also export menuGroups and createMenuGroups for advanced use cases
export { menuGroups, createMenuGroups };
