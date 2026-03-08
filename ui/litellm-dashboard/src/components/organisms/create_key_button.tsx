"use client";
import { keyKeys } from "@/app/(dashboard)/hooks/keys/useKeys";
import { useProjects } from "@/app/(dashboard)/hooks/projects/useProjects";
import { useUISettings } from "@/app/(dashboard)/hooks/uiSettings/useUISettings";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { Accordion, AccordionBody, AccordionHeader, Button, Col, Grid, Text, TextInput, Title } from "@tremor/react";
import { Button as Button2, Form, Input, message, Modal, Radio, Select, Switch, Tag, Tooltip } from "antd";
import debounce from "lodash/debounce";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "@/i18n";
import { rolesWithWriteAccess } from "../../utils/roles";
import AgentSelector from "../agent_management/AgentSelector";
import { mapDisplayToInternalNames } from "../callback_info_helpers";
import AccessGroupSelector from "../common_components/AccessGroupSelector";
import BudgetDurationDropdown from "../common_components/budget_duration_dropdown";
import SchemaFormFields from "../common_components/check_openapi_schema";
import KeyLifecycleSettings from "../common_components/KeyLifecycleSettings";
import ModelAliasManager from "../common_components/ModelAliasManager";
import PassThroughRoutesSelector from "../common_components/PassThroughRoutesSelector";
import PremiumLoggingSettings from "../common_components/PremiumLoggingSettings";
import RateLimitTypeFormItem from "../common_components/RateLimitTypeFormItem";
import RouterSettingsAccordion, { RouterSettingsAccordionValue } from "../common_components/RouterSettingsAccordion";
import TeamDropdown from "../common_components/team_dropdown";
import ProjectDropdown from "../common_components/ProjectDropdown";
import { CreateUserButton } from "../CreateUserButton";
import { getModelDisplayName } from "../key_team_helpers/fetch_available_models_team_key";
import { Team } from "../key_team_helpers/key_list";
import MCPServerSelector from "../mcp_server_management/MCPServerSelector";
import MCPToolPermissions from "../mcp_server_management/MCPToolPermissions";
import NotificationsManager from "../molecules/notifications_manager";
import {
  getAgentsList,
  getGuardrailsList,
  getPoliciesList,
  getPossibleUserRoles,
  getPromptsList,
  keyCreateCall,
  keyCreateServiceAccountCall,
  modelAvailableCall,
  proxyBaseUrl,
  userFilterUICall,
} from "../networking";
import CreatedKeyDisplay from "../shared/CreatedKeyDisplay";
import NumericalInput from "../shared/numerical_input";
import VectorStoreSelector from "../vector_store_management/VectorStoreSelector";
import { simplifyKeyGenerateError } from "./utils";

const { Option } = Select;

/**
 * Interface for pre-filling the create key form from URL parameters
 */
export interface CreateKeyPrefillData {
  owned_by?: "you" | "service_account" | "another_user";
  team_id?: string;
  key_alias?: string;
  models?: string[];
  key_type?: "default" | "llm_api" | "management";
}

interface CreateKeyProps {
  team: Team | null;
  data: any[] | null;
  teams: Team[] | null;
  addKey: (data: any) => void;
  autoOpenCreate?: boolean;
  prefillData?: CreateKeyPrefillData;
}

interface User {
  user_id: string;
  user_email: string;
  role?: string;
}

interface UserOption {
  label: string;
  value: string;
  user: User;
}

const getPredefinedTags = (data: any[] | null) => {
  let allTags = [];

  console.log("data:", JSON.stringify(data));

  if (data) {
    for (let key of data) {
      if (key["metadata"] && key["metadata"]["tags"]) {
        allTags.push(...key["metadata"]["tags"]);
      }
    }
  }

  // Deduplicate using Set
  const uniqueTags = Array.from(new Set(allTags)).map((tag) => ({
    value: tag,
    label: tag,
  }));

  console.log("uniqueTags:", uniqueTags);
  return uniqueTags;
};

export const fetchTeamModels = async (
  userID: string,
  userRole: string,
  accessToken: string,
  teamID: string | null,
): Promise<string[]> => {
  try {
    if (userID === null || userRole === null) {
      return [];
    }

    if (accessToken !== null) {
      const model_available = await modelAvailableCall(accessToken, userID, userRole, true, teamID, true);
      let available_model_names = model_available["data"].map((element: { id: string }) => element.id);
      console.log("available_model_names:", available_model_names);
      return available_model_names;
    }
    return [];
  } catch (error) {
    console.error("Error fetching user models:", error);
    return [];
  }
};

export const fetchUserModels = async (
  userID: string,
  userRole: string,
  accessToken: string,
  setUserModels: (models: string[]) => void,
) => {
  try {
    if (userID === null || userRole === null) {
      return;
    }

    if (accessToken !== null) {
      const model_available = await modelAvailableCall(accessToken, userID, userRole);
      let available_model_names = model_available["data"].map((element: { id: string }) => element.id);
      console.log("available_model_names:", available_model_names);
      setUserModels(available_model_names);
    }
  } catch (error) {
    console.error("Error fetching user models:", error);
  }
};

/**
 * ─────────────────────────────────────────────────────────────────────────
 * @deprecated
 * This component is being DEPRECATED in favor of src/app/(dashboard)/virtual-keys/components/CreateKey.tsx
 * Please contribute to the new refactor.
 * ─────────────────────────────────────────────────────────────────────────
 */
const CreateKey: React.FC<CreateKeyProps> = ({ team, teams, data, addKey, autoOpenCreate, prefillData }) => {
  const { t } = useTranslation();
  const { accessToken, userId: userID, userRole, premiumUser } = useAuthorized();
  const canEditGuardrails = premiumUser || (userRole != null && rolesWithWriteAccess.includes(userRole));
  const { data: projects, isLoading: isProjectsLoading } = useProjects();
  const { data: uiSettingsData } = useUISettings();
  const enableProjectsUI = Boolean(uiSettingsData?.values?.enable_projects_ui);
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [apiKey, setApiKey] = useState(null);
  const [softBudget, setSoftBudget] = useState(null);
  const [userModels, setUserModels] = useState<string[]>([]);
  const [modelsToPick, setModelsToPick] = useState<string[]>([]);
  const [keyOwner, setKeyOwner] = useState("you");
  const [predefinedTags, setPredefinedTags] = useState(getPredefinedTags(data));
  const [hasPrefilled, setHasPrefilled] = useState(false);
  const [pendingPrefillModels, setPendingPrefillModels] = useState<string[] | null>(null);
  const [guardrailsList, setGuardrailsList] = useState<string[]>([]);
  const [policiesList, setPoliciesList] = useState<string[]>([]);
  const [promptsList, setPromptsList] = useState<string[]>([]);
  const [loggingSettings, setLoggingSettings] = useState<any[]>([]);
  const [selectedCreateKeyTeam, setSelectedCreateKeyTeam] = useState<Team | null>(team);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isCreateUserModalVisible, setIsCreateUserModalVisible] = useState(false);
  const [newlyCreatedUserId, setNewlyCreatedUserId] = useState<string | null>(null);
  const [possibleUIRoles, setPossibleUIRoles] = useState<Record<string, Record<string, string>>>({});
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState<boolean>(false);
  const [mcpAccessGroups, setMcpAccessGroups] = useState<string[]>([]);
  const [disabledCallbacks, setDisabledCallbacks] = useState<string[]>([]);
  const [keyType, setKeyType] = useState<string>("llm_api");
  const [modelAliases, setModelAliases] = useState<{ [key: string]: string }>({});
  const [autoRotationEnabled, setAutoRotationEnabled] = useState<boolean>(false);
  const [rotationInterval, setRotationInterval] = useState<string>("30d");
  const [routerSettings, setRouterSettings] = useState<RouterSettingsAccordionValue | null>(null);
  const [routerSettingsKey, setRouterSettingsKey] = useState<number>(0);
  const [agentsList, setAgentsList] = useState<{ agent_id: string; agent_name: string }[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const handleOk = () => {
    setIsModalVisible(false);
    form.resetFields();
    setLoggingSettings([]);
    setDisabledCallbacks([]);
    setKeyType("llm_api");
    setModelAliases({});
    setAutoRotationEnabled(false);
    setRotationInterval("30d");
    setRouterSettings(null);
    setRouterSettingsKey((prev) => prev + 1);
    setSelectedAgentId(null);
    setSelectedProjectId(null);
  };

  const handleCancel = () => {
    setIsModalVisible(false);
    setApiKey(null);
    setSelectedCreateKeyTeam(null);
    form.resetFields();
    setLoggingSettings([]);
    setDisabledCallbacks([]);
    setKeyType("llm_api");
    setModelAliases({});
    setAutoRotationEnabled(false);
    setRotationInterval("30d");
    setRouterSettings(null);
    setRouterSettingsKey((prev) => prev + 1);
    setSelectedAgentId(null);
    setSelectedProjectId(null);
  };

  useEffect(() => {
    if (userID && userRole && accessToken) {
      fetchUserModels(userID, userRole, accessToken, setUserModels);
    }
  }, [accessToken, userID, userRole]);

  useEffect(() => {
    if (accessToken) {
      getAgentsList(accessToken)
        .then((res) => setAgentsList(res?.agents || []))
        .catch(() => setAgentsList([]));
    }
  }, [accessToken]);

  useEffect(() => {
    const fetchGuardrails = async () => {
      try {
        const response = await getGuardrailsList(accessToken);
        const guardrailNames = response.guardrails.map((g: { guardrail_name: string }) => g.guardrail_name);
        setGuardrailsList(guardrailNames);
      } catch (error) {
        console.error("Failed to fetch guardrails:", error);
      }
    };

    const fetchPolicies = async () => {
      try {
        const response = await getPoliciesList(accessToken);
        const policyNames = response.policies.map((p: { policy_name: string }) => p.policy_name);
        setPoliciesList(policyNames);
      } catch (error) {
        console.error("Failed to fetch policies:", error);
      }
    };

    const fetchPrompts = async () => {
      try {
        const response = await getPromptsList(accessToken);
        setPromptsList(response.prompts.map((prompt) => prompt.prompt_id));
      } catch (error) {
        console.error("Failed to fetch prompts:", error);
      }
    };

    fetchGuardrails();
    fetchPolicies();
    fetchPrompts();
  }, [accessToken]);

  // Fetch possible user roles when component mounts
  useEffect(() => {
    const fetchPossibleRoles = async () => {
      try {
        if (accessToken) {
          // Check if roles are cached in session storage
          const cachedRoles = sessionStorage.getItem("possibleUserRoles");
          if (cachedRoles) {
            setPossibleUIRoles(JSON.parse(cachedRoles));
          } else {
            const availableUserRoles = await getPossibleUserRoles(accessToken);
            sessionStorage.setItem("possibleUserRoles", JSON.stringify(availableUserRoles));
            setPossibleUIRoles(availableUserRoles);
          }
        }
      } catch (error) {
        console.error("Error fetching possible user roles:", error);
      }
    };

    fetchPossibleRoles();
  }, [accessToken]);

  // Auto-open modal and prefill form from URL params (deep link).
  // Guarded by write access so we don't open for read-only users.
  useEffect(() => {
    if (autoOpenCreate && !hasPrefilled && teams && userRole && rolesWithWriteAccess.includes(userRole)) {
      // Open the modal
      setIsModalVisible(true);
      setHasPrefilled(true);

      // Apply prefill data if provided
      if (prefillData) {
        // Set key owner (owned_by) - validate that "another_user" is only allowed for Admin
        if (prefillData.owned_by) {
          if (prefillData.owned_by === "another_user" && userRole !== "Admin") {
            // Ignore invalid owned_by for non-admin users, fall back to default
            setKeyOwner("you");
          } else {
            setKeyOwner(prefillData.owned_by);
          }
        }

        // Set team - find the team by ID and set it (only if team exists in user's teams)
        if (prefillData.team_id) {
          const selectedTeam = teams?.find((t) => t.team_id === prefillData.team_id) || null;
          if (selectedTeam) {
            setSelectedCreateKeyTeam(selectedTeam);
            form.setFieldsValue({ team_id: prefillData.team_id });
          }
          // Silently ignore invalid team_id - don't prefill with a team user doesn't have access to
        }

        // Set key alias
        if (prefillData.key_alias) {
          form.setFieldsValue({ key_alias: prefillData.key_alias });
        }

        // Defer model selection until we load the allowed model list.
        if (prefillData.models && prefillData.models.length > 0) {
          setPendingPrefillModels(prefillData.models);
        }

        // Set key type
        if (prefillData.key_type) {
          setKeyType(prefillData.key_type);
          form.setFieldsValue({ key_type: prefillData.key_type });
        }
      }
    }
  }, [autoOpenCreate, prefillData, teams, hasPrefilled, form, userRole]);

  // Check if team selection is required
  const isTeamSelectionRequired = modelsToPick.includes("no-default-models");
  const isFormDisabled = isTeamSelectionRequired && !selectedCreateKeyTeam;

  const handleCreate = async (formValues: Record<string, any>) => {
    try {
      const newKeyAlias = formValues?.key_alias ?? "";
      const newKeyTeamId = formValues?.team_id ?? null;

      const existingKeyAliases = data?.filter((k) => k.team_id === newKeyTeamId).map((k) => k.key_alias) ?? [];

      if (existingKeyAliases.includes(newKeyAlias)) {
        throw new Error(
          `Key alias ${newKeyAlias} already exists for team with ID ${newKeyTeamId}, please provide another key alias`,
        );
      }

      NotificationsManager.info(t("keys.form.makingApiCall") || "Making API Call");
      setIsModalVisible(true);

      if (keyOwner === "you") {
        formValues.user_id = userID;
      } else if (keyOwner === "agent") {
        if (!selectedAgentId) {
          NotificationsManager.fromBackend(t("keys.form.pleaseSelectAgent"));
          return;
        }
        formValues.agent_id = selectedAgentId;
      }

      // Handle metadata for all key types
      let metadata: Record<string, any> = {};
      try {
        metadata = JSON.parse(formValues.metadata || "{}");
      } catch (error) {
        console.error("Error parsing metadata:", error);
      }

      // If it's a service account, add the service_account_id to the metadata
      if (keyOwner === "service_account") {
        metadata["service_account_id"] = formValues.key_alias;
      }

      // Add logging settings to the metadata
      if (loggingSettings.length > 0) {
        metadata = {
          ...metadata,
          logging: loggingSettings.filter((config) => config.callback_name),
        };
      }

      // Add disabled callbacks to the metadata
      if (disabledCallbacks.length > 0) {
        // Map display names to internal callback values
        const mappedDisabledCallbacks = mapDisplayToInternalNames(disabledCallbacks);
        metadata = {
          ...metadata,
          litellm_disabled_callbacks: mappedDisabledCallbacks,
        };
      }

      // Add auto-rotation settings as top-level fields
      if (autoRotationEnabled) {
        formValues.auto_rotate = true;
        formValues.rotation_interval = rotationInterval;
      }

      // Handle duration field for key expiry - convert empty string to null
      if (!formValues.duration || formValues.duration.trim() === "") {
        formValues.duration = null;
      }

      // Update the formValues with the final metadata
      formValues.metadata = JSON.stringify(metadata);

      // Transform allowed_vector_store_ids and allowed_mcp_servers_and_groups into object_permission format
      if (formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) {
        formValues.object_permission = {
          vector_stores: formValues.allowed_vector_store_ids,
        };
        // Remove the original field as it's now part of object_permission
        delete formValues.allowed_vector_store_ids;
      }

      // Transform allowed_mcp_servers_and_groups into object_permission format
      if (
        formValues.allowed_mcp_servers_and_groups &&
        (formValues.allowed_mcp_servers_and_groups.servers?.length > 0 ||
          formValues.allowed_mcp_servers_and_groups.accessGroups?.length > 0)
      ) {
        if (!formValues.object_permission) {
          formValues.object_permission = {};
        }
        const { servers, accessGroups } = formValues.allowed_mcp_servers_and_groups;
        if (servers && servers.length > 0) {
          formValues.object_permission.mcp_servers = servers;
        }
        if (accessGroups && accessGroups.length > 0) {
          formValues.object_permission.mcp_access_groups = accessGroups;
        }
        // Remove the original field as it's now part of object_permission
        delete formValues.allowed_mcp_servers_and_groups;
      }

      // Add MCP tool permissions to object_permission
      const mcpToolPermissions = formValues.mcp_tool_permissions || {};
      if (Object.keys(mcpToolPermissions).length > 0) {
        if (!formValues.object_permission) {
          formValues.object_permission = {};
        }
        formValues.object_permission.mcp_tool_permissions = mcpToolPermissions;
      }
      delete formValues.mcp_tool_permissions;

      // Transform allowed_mcp_access_groups into object_permission format
      if (formValues.allowed_mcp_access_groups && formValues.allowed_mcp_access_groups.length > 0) {
        if (!formValues.object_permission) {
          formValues.object_permission = {};
        }
        formValues.object_permission.mcp_access_groups = formValues.allowed_mcp_access_groups;
        // Remove the original field as it's now part of object_permission
        delete formValues.allowed_mcp_access_groups;
      }

      // Transform allowed_agents_and_groups into object_permission format
      if (
        formValues.allowed_agents_and_groups &&
        (formValues.allowed_agents_and_groups.agents?.length > 0 ||
          formValues.allowed_agents_and_groups.accessGroups?.length > 0)
      ) {
        if (!formValues.object_permission) {
          formValues.object_permission = {};
        }
        const { agents, accessGroups } = formValues.allowed_agents_and_groups;
        if (agents && agents.length > 0) {
          formValues.object_permission.agents = agents;
        }
        if (accessGroups && accessGroups.length > 0) {
          formValues.object_permission.agent_access_groups = accessGroups;
        }
        // Remove the original field as it's now part of object_permission
        delete formValues.allowed_agents_and_groups;
      }

      // Add model_aliases if any are defined
      if (Object.keys(modelAliases).length > 0) {
        formValues.aliases = JSON.stringify(modelAliases);
      }

      // Add router_settings if any are defined
      if (routerSettings?.router_settings) {
        // Only include router_settings if it has at least one non-null value
        const hasValues = Object.values(routerSettings.router_settings).some(
          (value) => value !== null && value !== undefined && value !== "",
        );
        if (hasValues) {
          formValues.router_settings = routerSettings.router_settings;
        }
      }

      let response;
      if (keyOwner === "service_account") {
        response = await keyCreateServiceAccountCall(accessToken, formValues);
      } else {
        response = await keyCreateCall(accessToken, userID, formValues);
      }

      console.log("key create Response:", response);

      // Add the data to the state in the parent component
      // Also directly update the keys list in VirtualKeysTable without an API call
      addKey(response);

      // Invalidate and refetch all keys list queries to update the table
      // This will trigger a refetch of all key list queries regardless of pagination
      queryClient.invalidateQueries({ queryKey: keyKeys.lists() });

      setApiKey(response["key"]);
      setSoftBudget(response["soft_budget"]);
      NotificationsManager.success(t("notifications.keyCreatedSuccess"));
      form.resetFields();
      localStorage.removeItem("userData" + userID);
    } catch (error) {
      console.log("error in create key:", error);
      const simplifiedError = simplifyKeyGenerateError(error);
      NotificationsManager.fromBackend(simplifiedError);
    }
  };

  const handleCopy = () => {
    NotificationsManager.success(t("keys.copyKey"));
  };

  // Fetch available models when team or auth changes.
  // Note: Model prefill from URL params is handled by the useEffect below, which
  // watches for pendingPrefillModels + modelsToPick to both be populated.
  useEffect(() => {
    if (selectedProjectId) {
      // When a project is selected, use the project's models
      const project = projects?.find((p) => p.project_id === selectedProjectId);
      const projectModels = project?.models ?? [];
      setModelsToPick(projectModels);
      form.setFieldValue("models", []);
      return;
    }
    if (userID && userRole && accessToken) {
      fetchTeamModels(userID, userRole, accessToken, selectedCreateKeyTeam?.team_id ?? null).then((models) => {
        let allModels = Array.from(new Set([...(selectedCreateKeyTeam?.models ?? []), ...models]));
        setModelsToPick(allModels);
      });
    }
    // Only clear models if we don't have pending prefill models
    if (!pendingPrefillModels) {
      form.setFieldValue("models", []);
    }
  }, [selectedCreateKeyTeam, selectedProjectId, accessToken, userID, userRole, form]);

  // Apply deferred model prefill once the available model list arrives.
  // This handles timing where prefill data arrives before or after models are fetched.
  useEffect(() => {
    if (!pendingPrefillModels || pendingPrefillModels.length === 0) {
      return;
    }
    if (!modelsToPick || modelsToPick.length === 0) {
      return;
    }

    const validModels = pendingPrefillModels.filter((model) => modelsToPick.includes(model));
    if (validModels.length > 0) {
      form.setFieldsValue({ models: validModels });
    }
    setPendingPrefillModels(null);
  }, [pendingPrefillModels, modelsToPick, form]);

  // Sync team when project is selected but teams loaded later (race condition)
  useEffect(() => {
    if (!selectedProjectId || !teams) return;
    const project = projects?.find((p) => p.project_id === selectedProjectId);
    if (!project?.team_id) return;
    // If team is already set correctly, skip
    if (selectedCreateKeyTeam?.team_id === project.team_id) return;
    const projectTeam = teams.find((t) => t.team_id === project.team_id) || null;
    if (projectTeam) {
      setSelectedCreateKeyTeam(projectTeam);
      form.setFieldValue("team_id", projectTeam.team_id);
    }
  }, [teams, selectedProjectId, projects]);

  // Add a callback function to handle user creation
  const handleUserCreated = (userId: string) => {
    setNewlyCreatedUserId(userId);
    form.setFieldsValue({ user_id: userId });
    setIsCreateUserModalVisible(false);
  };

  const fetchUsers = async (searchText: string): Promise<void> => {
    if (!searchText) {
      setUserOptions([]);
      return;
    }

    setUserSearchLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("user_email", searchText); // Always search by email
      if (accessToken == null) {
        return;
      }
      const response = await userFilterUICall(accessToken, params);

      const data: User[] = response;
      const options: UserOption[] = data.map((user) => ({
        label: `${user.user_email} (${user.user_id})`,
        value: user.user_id,
        user,
      }));

      setUserOptions(options);
    } catch (error) {
      console.error("Error fetching users:", error);
      NotificationsManager.fromBackend(t("keys.ownership.searchFailed") || "Failed to search for users");
    } finally {
      setUserSearchLoading(false);
    }
  };

  const debouncedSearch = useCallback(
    debounce((text: string) => fetchUsers(text), 300),
    [accessToken],
  );

  const handleUserSearch = (value: string): void => {
    debouncedSearch(value);
  };

  const handleUserSelect = (_value: string, option: UserOption): void => {
    const selectedUser = option.user;
    form.setFieldsValue({
      user_id: selectedUser.user_id,
    });
  };

  return (
    <div>
      {userRole && rolesWithWriteAccess.includes(userRole) && (
        <Button className="mx-auto" onClick={() => setIsModalVisible(true)}>
          {t("keys.createNewKey")}
        </Button>
      )}
      <Modal open={isModalVisible} width={1000} footer={null} onOk={handleOk} onCancel={handleCancel}>
        <Form form={form} onFinish={handleCreate} labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} labelAlign="left">
          {/* Section 1: Key Ownership */}
          <div className="mb-8">
            <Title className="mb-4">{t("keys.ownership.title")}</Title>
            <Form.Item
              label={
                <span>
                  {t("keys.ownership.ownedBy")}{" "}
                  <Tooltip title={t("keys.ownership.ownedByTooltip")}>
                    <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                  </Tooltip>
                </span>
              }
              className="mb-4"
            >
              <Radio.Group onChange={(e) => setKeyOwner(e.target.value)} value={keyOwner}>
                <Radio value="you">{t("keys.ownership.you")}</Radio>
                <Radio value="service_account">{t("keys.ownership.serviceAccount")}</Radio>
                {userRole === "Admin" && <Radio value="another_user">{t("keys.ownership.anotherUser")}</Radio>}
                <Radio value="agent">
                  {t("keys.ownership.agent")} <Tag color="purple">{t("navbar.new")}</Tag>
                </Radio>
              </Radio.Group>
            </Form.Item>

            {keyOwner === "another_user" && (
              <Form.Item
                label={
                  <span>
                    {t("keys.ownership.userId")}{" "}
                    <Tooltip title={t("keys.ownership.userIdTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="user_id"
                className="mt-4"
                rules={[
                  {
                    required: keyOwner === "another_user",
                    message: t("keys.ownership.userIdValidation"),
                  },
                ]}
              >
                <div>
                  <div style={{ display: "flex", marginBottom: "8px" }}>
                    <Select
                      showSearch
                      placeholder={t("keys.ownership.searchByEmail")}
                      filterOption={false}
                      onSearch={handleUserSearch}
                      onSelect={(value, option) => handleUserSelect(value, option as UserOption)}
                      options={userOptions}
                      loading={userSearchLoading}
                      allowClear
                      style={{ width: "100%" }}
                      notFoundContent={userSearchLoading ? t("common.searching") : t("common.noResultsFound")}
                    />
                    <Button2 onClick={() => setIsCreateUserModalVisible(true)} style={{ marginLeft: "8px" }}>
                      {t("keys.ownership.createUser")}
                    </Button2>
                  </div>
                  <div className="text-xs text-gray-500">{t("keys.ownership.searchByEmailHint")}</div>
                </div>
              </Form.Item>
            )}
            {keyOwner === "agent" && (
              <div className="mt-4 p-4 bg-purple-50 border border-purple-200 rounded-md">
                <div className="mb-3">
                  <span className="text-sm font-medium text-gray-700">
                    {t("keys.ownership.selectAgent")} <span className="text-red-500">*</span>
                  </span>
                </div>
                <Select
                  showSearch
                  placeholder={t("keys.ownership.selectAgent")}
                  style={{ width: "100%" }}
                  value={selectedAgentId}
                  onChange={(value) => setSelectedAgentId(value)}
                  filterOption={(input, option) =>
                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                  }
                  options={agentsList.map((a) => ({
                    label: a.agent_name || a.agent_id,
                    value: a.agent_id,
                  }))}
                />
                <div className="text-xs text-gray-500 mt-2">
                  {t("keys.ownership.agentKeyDescription")}
                </div>
              </div>
            )}
            <Form.Item
              label={
                <span>
                  {t("keys.ownership.team")}{" "}
                  <Tooltip title={t("keys.ownership.teamTooltip")}>
                    <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                  </Tooltip>
                </span>
              }
              name="team_id"
              initialValue={team ? team.team_id : null}
              className="mt-4"
              rules={[
                {
                  required: keyOwner === "service_account",
                  message: t("keys.ownership.teamRequiredForServiceAccount"),
                },
              ]}
              help={keyOwner === "service_account" ? t("common.required") : ""}
            >
              <TeamDropdown
                teams={teams}
                disabled={selectedProjectId !== null}
                loading={!teams}
                onChange={(teamId) => {
                  const selectedTeam = teams?.find((t) => t.team_id === teamId) || null;
                  setSelectedCreateKeyTeam(selectedTeam);
                  setSelectedProjectId(null);
                  form.setFieldValue("project_id", undefined);
                }}
              />
            </Form.Item>
            {enableProjectsUI && (
              <Form.Item
                label={
                  <span>
                    {t("keys.ownership.project")}{" "}
                    <Tooltip title={t("keys.ownership.projectTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="project_id"
                className="mt-4"
              >
                <ProjectDropdown
                  projects={projects}
                  teamId={selectedCreateKeyTeam?.team_id}
                  loading={isProjectsLoading || !teams}
                  onChange={(projectId) => {
                    if (!projectId) {
                      setSelectedProjectId(null);
                      setSelectedCreateKeyTeam(null);
                      form.setFieldValue("team_id", undefined);
                      return;
                    }
                    setSelectedProjectId(projectId);
                  }}
                />
              </Form.Item>
            )}
          </div>

          {/* Show message when team selection is required */}
          {isFormDisabled && (
            <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <Text className="text-blue-800 text-sm">
                {t("keys.ownership.selectTeamToContinue")}
              </Text>
            </div>
          )}

          {/* Section 2: Key Details */}
          {!isFormDisabled && (
            <div className="mb-8">
              <Title className="mb-4">{t("keys.details.title")}</Title>
              <Form.Item
                label={
                  <span>
                    {keyOwner === "you" || keyOwner === "another_user" ? t("keys.form.keyName") : t("keys.form.serviceAccountId")}{" "}
                    <Tooltip
                      title={
                        keyOwner === "you" || keyOwner === "another_user"
                          ? t("keys.form.keyNameTooltip")
                          : t("keys.form.serviceAccountIdTooltip")
                      }
                    >
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="key_alias"
                rules={[
                  {
                    required: true,
                    message: keyOwner === "you" ? t("keys.form.pleaseInputKeyName") : t("keys.form.pleaseInputServiceAccountId"),
                  },
                ]}
                help={t("common.required")}
              >
                <TextInput placeholder="" />
              </Form.Item>

              <Form.Item
                label={
                  <span>
                    {t("keys.form.models")}{" "}
                    <Tooltip title={t("keys.form.modelsTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="models"
                rules={[]}
                help={
                  keyType === "management" || keyType === "read_only"
                    ? t("keys.form.modelsDisabledForKeyType")
                    : t("keys.form.optionalLeaveEmpty")
                }
                className="mt-4"
              >
                <Select
                  mode="multiple"
                  placeholder={t("keys.form.selectModels")}
                  style={{ width: "100%" }}
                  disabled={keyType === "management" || keyType === "read_only"}
                  onChange={(values) => {
                    if (values.includes("all-team-models")) {
                      form.setFieldsValue({ models: ["all-team-models"] });
                    }
                  }}
                >
                  {!selectedProjectId && (
                    <Option key="all-team-models" value="all-team-models">
                      {t("keys.form.allTeamModels")}
                    </Option>
                  )}
                  {modelsToPick.map((model: string) => (
                    <Option key={model} value={model}>
                      {getModelDisplayName(model)}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                label={
                  <span>
                    {t("keys.form.keyType")}{" "}
                    <Tooltip title={t("keys.form.keyTypeTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="key_type"
                initialValue="llm_api"
                className="mt-4"
              >
                <Select
                  defaultValue="llm_api"
                  placeholder={t("keys.form.selectKeyType")}
                  style={{ width: "100%" }}
                  optionLabelProp="label"
                  onChange={(value) => {
                    setKeyType(value);
                    // Clear models field and disable if management or read_only
                    if (value === "management" || value === "read_only") {
                      form.setFieldsValue({ models: [] });
                    }
                  }}
                >
                  <Option value="default" label={t("keys.form.default")}>
                    <div style={{ padding: "4px 0" }}>
                      <div style={{ fontWeight: 500 }}>{t("keys.form.default")}</div>
                      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                        {t("keys.form.defaultDesc")}
                      </div>
                    </div>
                  </Option>
                  <Option value="llm_api" label={t("keys.form.aiApis")}>
                    <div style={{ padding: "4px 0" }}>
                      <div style={{ fontWeight: 500 }}>{t("keys.form.aiApis")}</div>
                      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                        {t("keys.form.aiApisDesc")}
                      </div>
                    </div>
                  </Option>
                  <Option value="management" label={t("keys.form.management")}>
                    <div style={{ padding: "4px 0" }}>
                      <div style={{ fontWeight: 500 }}>{t("keys.form.management")}</div>
                      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "2px" }}>
                        {t("keys.form.managementDesc")}
                      </div>
                    </div>
                  </Option>
                </Select>
              </Form.Item>
            </div>
          )}

          {/* Section 3: Optional Settings */}
          {!isFormDisabled && (
            <div className="mb-8">
              <Accordion className="mt-4 mb-4">
                <AccordionHeader>
                  <Title className="m-0">{t("keys.form.optionalSettings")}</Title>
                </AccordionHeader>
                <AccordionBody>
                  <Form.Item
                    className="mt-4"
                    label={
                      <span>
                        {t("keys.form.maxBudgetUsd")}{" "}
                        <Tooltip title={t("keys.form.maxBudgetTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="max_budget"
                    help={`Budget cannot exceed team max budget: $${team?.max_budget !== null && team?.max_budget !== undefined ? team?.max_budget : "unlimited"}`}
                    rules={[
                      {
                        validator: async (_, value) => {
                          if (value && team && team.max_budget !== null && value > team.max_budget) {
                            throw new Error(
                              `Budget cannot exceed team max budget: $${formatNumberWithCommas(team.max_budget, 4)}`,
                            );
                          }
                        },
                      },
                    ]}
                  >
                    <NumericalInput step={0.01} precision={2} width={200} />
                  </Form.Item>
                  <Form.Item
                    className="mt-4"
                    label={
                      <span>
                        {t("keys.form.resetBudget")}{" "}
                        <Tooltip title={t("keys.form.resetBudgetTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="budget_duration"
                    help={`Team Reset Budget: ${team?.budget_duration !== null && team?.budget_duration !== undefined ? team?.budget_duration : "None"}`}
                  >
                    <BudgetDurationDropdown onChange={(value) => form.setFieldValue("budget_duration", value)} />
                  </Form.Item>
                  <Form.Item
                    className="mt-4"
                    label={
                      <span>
                        {t("keys.form.tpmLimit")}{" "}
                        <Tooltip title={t("keys.form.tpmTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="tpm_limit"
                    help={`TPM cannot exceed team TPM limit: ${team?.tpm_limit !== null && team?.tpm_limit !== undefined ? team?.tpm_limit : "unlimited"}`}
                    rules={[
                      {
                        validator: async (_, value) => {
                          if (value && team && team.tpm_limit !== null && value > team.tpm_limit) {
                            throw new Error(`TPM limit cannot exceed team TPM limit: ${team.tpm_limit}`);
                          }
                        },
                      },
                    ]}
                  >
                    <NumericalInput step={1} width={400} />
                  </Form.Item>
                  <RateLimitTypeFormItem
                    type="tpm"
                    name="tpm_limit_type"
                    className="mt-4"
                    initialValue={null}
                    form={form}
                    showDetailedDescriptions={true}
                  />
                  <Form.Item
                    className="mt-4"
                    label={
                      <span>
                        {t("keys.form.rpmLimit")}{" "}
                        <Tooltip title={t("keys.form.rpmTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="rpm_limit"
                    help={`RPM cannot exceed team RPM limit: ${team?.rpm_limit !== null && team?.rpm_limit !== undefined ? team?.rpm_limit : "unlimited"}`}
                    rules={[
                      {
                        validator: async (_, value) => {
                          if (value && team && team.rpm_limit !== null && value > team.rpm_limit) {
                            throw new Error(`RPM limit cannot exceed team RPM limit: ${team.rpm_limit}`);
                          }
                        },
                      },
                    ]}
                  >
                    <NumericalInput step={1} width={400} />
                  </Form.Item>
                  <RateLimitTypeFormItem
                    type="rpm"
                    name="rpm_limit_type"
                    className="mt-4"
                    initialValue={null}
                    form={form}
                    showDetailedDescriptions={true}
                  />
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.guardrails")}{" "}
                        <Tooltip title={t("keys.form.guardrailsTooltip")}>
                          <a
                            href="https://docs.litellm.ai/docs/proxy/guardrails/quick_start"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()} // Prevent accordion from collapsing when clicking link
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </a>
                        </Tooltip>
                      </span>
                    }
                    name="guardrails"
                    className="mt-4"
                    help={
                      canEditGuardrails
                        ? t("keys.form.selectExistingGuardrails")
                        : t("keys.form.premiumGuardrails")
                    }
                  >
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      disabled={!canEditGuardrails}
                      placeholder={
                        !canEditGuardrails
                          ? t("keys.form.premiumGuardrails")
                          : t("keys.form.selectGuardrails")
                      }
                      options={guardrailsList.map((name) => ({ value: name, label: name }))}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.disableGlobalGuardrails")}{" "}
                        <Tooltip title={t("keys.form.disableGlobalGuardrailsTooltip")}>
                          <a
                            href="https://docs.litellm.ai/docs/proxy/guardrails/quick_start"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()} // Prevent accordion from collapsing when clicking link
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </a>
                        </Tooltip>
                      </span>
                    }
                    name="disable_global_guardrails"
                    className="mt-4"
                    valuePropName="checked"
                    help={
                      canEditGuardrails
                        ? t("keys.form.bypassGlobalGuardrails")
                        : t("keys.form.premiumDisableGlobalGuardrails")
                    }
                  >
                    <Switch disabled={!canEditGuardrails} checkedChildren={t("common.yes")} unCheckedChildren={t("common.no")} />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.policies")}{" "}
                        <Tooltip title={t("keys.form.policiesTooltip")}>
                          <a
                            href="https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()} // Prevent accordion from collapsing when clicking link
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </a>
                        </Tooltip>
                      </span>
                    }
                    name="policies"
                    className="mt-4"
                    help={
                      premiumUser
                        ? t("keys.form.selectExistingPolicies")
                        : t("keys.form.premiumPolicies")
                    }
                  >
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      disabled={!premiumUser}
                      placeholder={
                        !premiumUser ? t("keys.form.premiumPolicies") : t("keys.form.selectPolicies")
                      }
                      options={policiesList.map((name) => ({ value: name, label: name }))}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.prompts")}{" "}
                        <Tooltip title={t("keys.form.promptsTooltip")}>
                          <a
                            href="https://docs.litellm.ai/docs/proxy/prompt_management"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()} // Prevent accordion from collapsing when clicking link
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </a>
                        </Tooltip>
                      </span>
                    }
                    name="prompts"
                    className="mt-4"
                    help={
                      premiumUser
                        ? t("keys.form.selectExistingPrompts")
                        : t("keys.form.premiumPrompts")
                    }
                  >
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      disabled={!premiumUser}
                      placeholder={
                        !premiumUser ? t("keys.form.premiumPrompts") : t("keys.form.selectPrompts")
                      }
                      options={promptsList.map((name) => ({ value: name, label: name }))}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.accessGroups")}{" "}
                        <Tooltip title={t("keys.form.accessGroupsTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="access_group_ids"
                    className="mt-4"
                    help={t("keys.form.selectAccessGroupsHelp")}
                  >
                    <AccessGroupSelector placeholder={t("keys.form.selectAccessGroups")} />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.allowedPassThroughRoutes")}{" "}
                        <Tooltip title={t("keys.form.passThroughTooltip")}>
                          <a
                            href="https://docs.litellm.ai/docs/proxy/pass_through"
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()} // Prevent accordion from collapsing when clicking link
                          >
                            <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                          </a>
                        </Tooltip>
                      </span>
                    }
                    name="allowed_passthrough_routes"
                    className="mt-4"
                    help={
                      premiumUser
                        ? t("keys.form.selectExistingPassThrough")
                        : t("keys.form.premiumPassThrough")
                    }
                  >
                    <PassThroughRoutesSelector
                      onChange={(values: string[]) => form.setFieldValue("allowed_passthrough_routes", values)}
                      value={form.getFieldValue("allowed_passthrough_routes")}
                      accessToken={accessToken}
                      placeholder={
                        !premiumUser
                          ? t("keys.form.premiumPassThrough")
                          : t("keys.form.selectPassThroughRoutes")
                      }
                      disabled={!premiumUser}
                      teamId={selectedCreateKeyTeam ? selectedCreateKeyTeam.team_id : null}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.allowedVectorStores")}{" "}
                        <Tooltip title={t("keys.form.vectorStoresTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="allowed_vector_store_ids"
                    className="mt-4"
                    help={t("keys.form.selectVectorStoresHelp")}
                  >
                    <VectorStoreSelector
                      onChange={(values: string[]) => form.setFieldValue("allowed_vector_store_ids", values)}
                      value={form.getFieldValue("allowed_vector_store_ids")}
                      accessToken={accessToken}
                      placeholder={t("keys.form.selectVectorStores")}
                    />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.metadata")}{" "}
                        <Tooltip title={t("keys.form.metadataTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="metadata"
                    className="mt-4"
                  >
                    <Input.TextArea rows={4} placeholder={t("keys.form.enterMetadataJson")} />
                  </Form.Item>
                  <Form.Item
                    label={
                      <span>
                        {t("keys.form.tags")}{" "}
                        <Tooltip title={t("keys.form.tagsTooltip")}>
                          <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                        </Tooltip>
                      </span>
                    }
                    name="tags"
                    className="mt-4"
                    help={t("keys.form.tagsHelp")}
                  >
                    <Select
                      mode="tags"
                      style={{ width: "100%" }}
                      placeholder={t("keys.form.enterTags")}
                      tokenSeparators={[","]}
                      options={predefinedTags}
                    />
                  </Form.Item>
                  <Accordion className="mt-4 mb-4">
                    <AccordionHeader>
                      <b>{t("keys.form.mcpSettings")}</b>
                    </AccordionHeader>
                    <AccordionBody>
                      <Form.Item
                        label={
                          <span>
                            {t("keys.form.allowedMcpServers")}{" "}
                            <Tooltip title={t("keys.form.mcpServersTooltip")}>
                              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                            </Tooltip>
                          </span>
                        }
                        name="allowed_mcp_servers_and_groups"
                        help={t("keys.form.selectMcpServersHelp")}
                      >
                        <MCPServerSelector
                          onChange={(val: any) => form.setFieldValue("allowed_mcp_servers_and_groups", val)}
                          value={form.getFieldValue("allowed_mcp_servers_and_groups")}
                          accessToken={accessToken}
                          placeholder={t("keys.form.selectMcpServers")}
                        />
                      </Form.Item>

                      {/* Hidden field to register mcp_tool_permissions with the form */}
                      <Form.Item name="mcp_tool_permissions" initialValue={{}} hidden>
                        <Input type="hidden" />
                      </Form.Item>

                      <Form.Item
                        noStyle
                        shouldUpdate={(prevValues, currentValues) =>
                          prevValues.allowed_mcp_servers_and_groups !== currentValues.allowed_mcp_servers_and_groups ||
                          prevValues.mcp_tool_permissions !== currentValues.mcp_tool_permissions
                        }
                      >
                        {() => (
                          <div className="mt-6">
                            <MCPToolPermissions
                              accessToken={accessToken}
                              selectedServers={form.getFieldValue("allowed_mcp_servers_and_groups")?.servers || []}
                              toolPermissions={form.getFieldValue("mcp_tool_permissions") || {}}
                              onChange={(toolPerms) => form.setFieldsValue({ mcp_tool_permissions: toolPerms })}
                            />
                          </div>
                        )}
                      </Form.Item>
                    </AccordionBody>
                  </Accordion>

                  <Accordion className="mt-4 mb-4">
                    <AccordionHeader>
                      <b>{t("keys.form.agentSettings")}</b>
                    </AccordionHeader>
                    <AccordionBody>
                      <Form.Item
                        label={
                          <span>
                            {t("keys.form.allowedAgents")}{" "}
                            <Tooltip title={t("keys.form.agentsTooltip")}>
                              <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                            </Tooltip>
                          </span>
                        }
                        name="allowed_agents_and_groups"
                        help={t("keys.form.selectAgentsHelp")}
                      >
                        <AgentSelector
                          onChange={(val: any) => form.setFieldValue("allowed_agents_and_groups", val)}
                          value={form.getFieldValue("allowed_agents_and_groups")}
                          accessToken={accessToken}
                          placeholder={t("keys.form.selectAgents")}
                        />
                      </Form.Item>
                    </AccordionBody>
                  </Accordion>

                  {premiumUser ? (
                    <Accordion className="mt-4 mb-4">
                      <AccordionHeader>
                        <b>{t("keys.form.loggingSettings")}</b>
                      </AccordionHeader>
                      <AccordionBody>
                        <div className="mt-4">
                          <PremiumLoggingSettings
                            value={loggingSettings}
                            onChange={setLoggingSettings}
                            premiumUser={true}
                            disabledCallbacks={disabledCallbacks}
                            onDisabledCallbacksChange={setDisabledCallbacks}
                          />
                        </div>
                      </AccordionBody>
                    </Accordion>
                  ) : (
                    <Tooltip
                      title={
                        <span>
                          {t("keys.form.loggingEnterprise")} -
                          <a href="https://www.litellm.ai/enterprise" target="_blank">
                            https://www.litellm.ai/enterprise
                          </a>
                        </span>
                      }
                      placement="top"
                    >
                      <div style={{ position: "relative" }}>
                        <div style={{ opacity: 0.5 }}>
                          <Accordion className="mt-4 mb-4">
                            <AccordionHeader>
                              <b>{t("keys.form.loggingSettings")}</b>
                            </AccordionHeader>
                            <AccordionBody>
                              <div className="mt-4">
                                <PremiumLoggingSettings
                                  value={loggingSettings}
                                  onChange={setLoggingSettings}
                                  premiumUser={false}
                                  disabledCallbacks={disabledCallbacks}
                                  onDisabledCallbacksChange={setDisabledCallbacks}
                                />
                              </div>
                            </AccordionBody>
                          </Accordion>
                        </div>
                        <div style={{ position: "absolute", inset: 0, cursor: "not-allowed" }} />
                      </div>
                    </Tooltip>
                  )}

                  <Accordion key={`router-settings-accordion-${routerSettingsKey}`} className="mt-4 mb-4">
                    <AccordionHeader>
                      <b>{t("keys.form.routerSettings")}</b>
                    </AccordionHeader>
                    <AccordionBody>
                      <div className="mt-4 w-full">
                        <RouterSettingsAccordion
                          key={routerSettingsKey}
                          accessToken={accessToken || ""}
                          value={routerSettings || undefined}
                          onChange={setRouterSettings}
                          modelData={
                            userModels.length > 0
                              ? { data: userModels.map((model) => ({ model_name: model })) }
                              : undefined
                          }
                        />
                      </div>
                    </AccordionBody>
                  </Accordion>

                  <Accordion className="mt-4 mb-4">
                    <AccordionHeader>
                      <b>{t("keys.form.modelAliases")}</b>
                    </AccordionHeader>
                    <AccordionBody>
                      <div className="mt-4">
                        <Text className="text-sm text-gray-600 mb-4">
                          {t("keys.form.modelAliasesDesc")}
                        </Text>
                        <ModelAliasManager
                          accessToken={accessToken}
                          initialModelAliases={modelAliases}
                          onAliasUpdate={setModelAliases}
                          showExampleConfig={false}
                        />
                      </div>
                    </AccordionBody>
                  </Accordion>

                  <Accordion className="mt-4 mb-4">
                    <AccordionHeader>
                      <b>{t("keys.form.keyLifecycle")}</b>
                    </AccordionHeader>
                    <AccordionBody>
                      <div className="mt-4">
                        <KeyLifecycleSettings
                          form={form}
                          autoRotationEnabled={autoRotationEnabled}
                          onAutoRotationChange={setAutoRotationEnabled}
                          rotationInterval={rotationInterval}
                          onRotationIntervalChange={setRotationInterval}
                          isCreateMode={true}
                        />
                      </div>
                    </AccordionBody>
                    <Form.Item name="duration" hidden initialValue={null}>
                      <Input />
                    </Form.Item>
                  </Accordion>
                  <Accordion className="mt-4 mb-4">
                    <AccordionHeader>
                      <div className="flex items-center gap-2">
                        <b>{t("keys.form.advancedSettings")}</b>
                        <Tooltip
                          title={
                            <span>
                              {t("keys.form.advancedSettingsTooltip")}{" "}
                              <a
                                href={
                                  proxyBaseUrl
                                    ? `${proxyBaseUrl}/#/key%20management/generate_key_fn_key_generate_post`
                                    : `/#/key%20management/generate_key_fn_key_generate_post`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-400 hover:text-blue-300"
                              >
                                {t("keys.form.documentation")}
                              </a>
                            </span>
                          }
                        >
                          <InfoCircleOutlined className="text-gray-400 hover:text-gray-300 cursor-help" />
                        </Tooltip>
                      </div>
                    </AccordionHeader>
                    <AccordionBody>
                      <SchemaFormFields
                        schemaComponent="GenerateKeyRequest"
                        form={form}
                        excludedFields={[
                          "key_alias",
                          "team_id",
                          "models",
                          "duration",
                          "metadata",
                          "tags",
                          "guardrails",
                          "max_budget",
                          "budget_duration",
                          "tpm_limit",
                          "rpm_limit",
                        ]}
                      />
                    </AccordionBody>
                  </Accordion>
                </AccordionBody>
              </Accordion>
            </div>
          )}

          <div style={{ textAlign: "right", marginTop: "10px" }}>
            <Button2 htmlType="submit" disabled={isFormDisabled} style={{ opacity: isFormDisabled ? 0.5 : 1 }}>
              {t("keys.form.createKey")}
            </Button2>
          </div>
        </Form>
      </Modal>

      {/* Add the Create User Modal */}
      {isCreateUserModalVisible && (
        <Modal
          title={t("keys.form.createNewUser")}
          open={isCreateUserModalVisible}
          onCancel={() => setIsCreateUserModalVisible(false)}
          footer={null}
          width={800}
        >
          <CreateUserButton
            userID={userID}
            accessToken={accessToken}
            teams={teams}
            possibleUIRoles={possibleUIRoles}
            onUserCreated={handleUserCreated}
            isEmbedded={true}
          />
        </Modal>
      )}

      {apiKey && (
        <Modal open={isModalVisible} onOk={handleOk} onCancel={handleCancel} footer={null}>
          <Grid numItems={1} className="gap-2 w-full">
            <Title>{t("keys.form.saveYourKey")}</Title>
            <Col numColSpan={1}>
              {apiKey != null ? (
                <CreatedKeyDisplay apiKey={apiKey} />
              ) : (
                <Text>{t("keys.form.keyBeingCreated")}</Text>
              )}
            </Col>
          </Grid>
        </Modal>
      )}
    </div>
  );
};

export default CreateKey;
