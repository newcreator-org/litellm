import { Button as Button2, Form, Input, Modal, Select as Select2, Switch, Tooltip } from "antd";
import { Accordion, AccordionBody, AccordionHeader, Text, TextInput } from "@tremor/react";
import { InfoCircleOutlined } from "@ant-design/icons";
import {
  fetchAvailableModelsForTeamOrKey,
  getModelDisplayName,
  unfurlWildcardModelsInList,
} from "@/components/key_team_helpers/fetch_available_models_team_key";
import NumericalInput from "@/components/shared/numerical_input";
import VectorStoreSelector from "@/components/vector_store_management/VectorStoreSelector";
import MCPServerSelector from "@/components/mcp_server_management/MCPServerSelector";
import AgentSelector from "@/components/agent_management/AgentSelector";
import PremiumLoggingSettings from "@/components/common_components/PremiumLoggingSettings";
import ModelAliasManager from "@/components/common_components/ModelAliasManager";
import React, { useEffect, useState } from "react";
import NotificationsManager from "@/components/molecules/notifications_manager";
import { fetchMCPAccessGroups, getGuardrailsList, getPoliciesList, Organization, Team, teamCreateCall } from "@/components/networking";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import MCPToolPermissions from "@/components/mcp_server_management/MCPToolPermissions";
import { useTranslation } from "@/i18n";

interface ModelAliases {
  [key: string]: string;
}

interface CreateTeamModalProps {
  isTeamModalVisible: boolean;
  handleOk: () => void;
  handleCancel: () => void;
  currentOrg: Organization | null;
  organizations: Organization[] | null;
  teams: Team[] | null;
  setTeams: (teams: Team[] | null) => void;
  modelAliases: ModelAliases;
  setModelAliases: (modelAliases: ModelAliases) => void;
  loggingSettings: any[];
  setLoggingSettings: (loggingSettings: any[]) => void;
  setIsTeamModalVisible: (isTeamModalVisible: boolean) => void;
}

const getOrganizationModels = (organization: Organization | null, userModels: string[]) => {
  let tempModelsToPick = [];

  if (organization) {
    if (organization.models.length > 0) {
      console.log(`organization.models: ${organization.models}`);
      tempModelsToPick = organization.models;
    } else {
      // show all available models if the team has no models set
      tempModelsToPick = userModels;
    }
  } else {
    // no team set, show all available models
    tempModelsToPick = userModels;
  }

  return unfurlWildcardModelsInList(tempModelsToPick, userModels);
};

const CreateTeamModal = ({
  isTeamModalVisible,
  handleOk,
  handleCancel,
  currentOrg,
  organizations,
  teams,
  setTeams,
  modelAliases,
  setModelAliases,
  loggingSettings,
  setLoggingSettings,
  setIsTeamModalVisible,
}: CreateTeamModalProps) => {
  const { userId: userID, userRole, accessToken, premiumUser } = useAuthorized();
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [userModels, setUserModels] = useState<string[]>([]);
  const [currentOrgForCreateTeam, setCurrentOrgForCreateTeam] = useState<Organization | null>(null);
  const [modelsToPick, setModelsToPick] = useState<string[]>([]);
  const [guardrailsList, setGuardrailsList] = useState<string[]>([]);
  const [policiesList, setPoliciesList] = useState<string[]>([]);
  const [mcpAccessGroups, setMcpAccessGroups] = useState<string[]>([]);
  const [mcpAccessGroupsLoaded, setMcpAccessGroupsLoaded] = useState(false);

  useEffect(() => {
    const fetchUserModels = async () => {
      try {
        if (userID === null || userRole === null || accessToken === null) {
          return;
        }
        const models = await fetchAvailableModelsForTeamOrKey(userID, userRole, accessToken);
        if (models) {
          setUserModels(models);
        }
      } catch (error) {
        console.error("Error fetching user models:", error);
      }
    };

    fetchUserModels();
  }, [accessToken, userID, userRole, teams]);

  useEffect(() => {
    console.log(`currentOrgForCreateTeam: ${currentOrgForCreateTeam}`);
    const models = getOrganizationModels(currentOrgForCreateTeam, userModels);
    console.log(`models: ${models}`);
    setModelsToPick(models);
    form.setFieldValue("models", []);
  }, [currentOrgForCreateTeam, userModels, form]);

  const fetchMcpAccessGroups = async () => {
    try {
      if (accessToken == null) {
        return;
      }
      const groups = await fetchMCPAccessGroups(accessToken);
      setMcpAccessGroups(groups);
    } catch (error) {
      console.error("Failed to fetch MCP access groups:", error);
    }
  };

  useEffect(() => {
    fetchMcpAccessGroups();
  }, [accessToken, fetchMcpAccessGroups]);

  useEffect(() => {
    const fetchGuardrails = async () => {
      try {
        if (accessToken == null) {
          return;
        }

        const response = await getGuardrailsList(accessToken);
        const guardrailNames = response.guardrails.map((g: { guardrail_name: string }) => g.guardrail_name);
        setGuardrailsList(guardrailNames);
      } catch (error) {
        console.error("Failed to fetch guardrails:", error);
      }
    };

    const fetchPolicies = async () => {
      try {
        if (accessToken == null) {
          return;
        }

        const response = await getPoliciesList(accessToken);
        const policyNames = response.policies.map((p: { policy_name: string }) => p.policy_name);
        setPoliciesList(policyNames);
      } catch (error) {
        console.error("Failed to fetch policies:", error);
      }
    };

    fetchGuardrails();
    fetchPolicies();
  }, [accessToken]);

  const handleCreate = async (formValues: Record<string, any>) => {
    try {
      console.log(`formValues: ${JSON.stringify(formValues)}`);
      if (accessToken != null) {
        const newTeamAlias = formValues?.team_alias;
        const existingTeamAliases = teams?.map((t) => t.team_alias) ?? [];
        let organizationId = formValues?.organization_id || currentOrg?.organization_id;
        if (organizationId === "" || typeof organizationId !== "string") {
          formValues.organization_id = null;
        } else {
          formValues.organization_id = organizationId.trim();
        }

        // Remove guardrails from top level since it's now in metadata
        if (existingTeamAliases.includes(newTeamAlias)) {
          throw new Error(`Team alias ${newTeamAlias} already exists, please pick another alias`);
        }

        NotificationsManager.info(t("teams.creatingTeam"));

        // Handle logging settings in metadata
        if (loggingSettings.length > 0) {
          let metadata = {};
          if (formValues.metadata) {
            try {
              metadata = JSON.parse(formValues.metadata);
            } catch (e) {
              console.warn("Invalid JSON in metadata field, starting with empty object");
            }
          }

          // Add logging settings to metadata
          metadata = {
            ...metadata,
            logging: loggingSettings.filter((config) => config.callback_name), // Only include configs with callback_name
          };

          formValues.metadata = JSON.stringify(metadata);
        }

        if (formValues.secret_manager_settings) {
          if (typeof formValues.secret_manager_settings === "string") {
            if (formValues.secret_manager_settings.trim() === "") {
              delete formValues.secret_manager_settings;
            } else {
              try {
                formValues.secret_manager_settings = JSON.parse(formValues.secret_manager_settings);
              } catch (e) {
                throw new Error("Failed to parse secret manager settings: " + e);
              }
            }
          }
        }

        // Transform allowed_vector_store_ids and allowed_mcp_servers_and_groups into object_permission
        if (
          (formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) ||
          (formValues.allowed_mcp_servers_and_groups &&
            (formValues.allowed_mcp_servers_and_groups.servers?.length > 0 ||
              formValues.allowed_mcp_servers_and_groups.accessGroups?.length > 0 ||
              formValues.allowed_mcp_servers_and_groups.toolPermissions))
        ) {
          formValues.object_permission = {};
          if (formValues.allowed_vector_store_ids && formValues.allowed_vector_store_ids.length > 0) {
            formValues.object_permission.vector_stores = formValues.allowed_vector_store_ids;
            delete formValues.allowed_vector_store_ids;
          }
          if (formValues.allowed_mcp_servers_and_groups) {
            const { servers, accessGroups } = formValues.allowed_mcp_servers_and_groups;
            if (servers && servers.length > 0) {
              formValues.object_permission.mcp_servers = servers;
            }
            if (accessGroups && accessGroups.length > 0) {
              formValues.object_permission.mcp_access_groups = accessGroups;
            }
            delete formValues.allowed_mcp_servers_and_groups;
          }

          // Add tool permissions separately
          if (formValues.mcp_tool_permissions && Object.keys(formValues.mcp_tool_permissions).length > 0) {
            if (!formValues.object_permission) {
              formValues.object_permission = {};
            }
            formValues.object_permission.mcp_tool_permissions = formValues.mcp_tool_permissions;
            delete formValues.mcp_tool_permissions;
          }

          // Handle agent permissions
          if (formValues.allowed_agents_and_groups) {
            const { agents, accessGroups } = formValues.allowed_agents_and_groups;
            if (!formValues.object_permission) {
              formValues.object_permission = {};
            }
            if (agents && agents.length > 0) {
              formValues.object_permission.agents = agents;
            }
            if (accessGroups && accessGroups.length > 0) {
              formValues.object_permission.agent_access_groups = accessGroups;
            }
            delete formValues.allowed_agents_and_groups;
          }
        }

        // Transform allowed_mcp_access_groups into object_permission
        if (formValues.allowed_mcp_access_groups && formValues.allowed_mcp_access_groups.length > 0) {
          if (!formValues.object_permission) {
            formValues.object_permission = {};
          }
          formValues.object_permission.mcp_access_groups = formValues.allowed_mcp_access_groups;
          delete formValues.allowed_mcp_access_groups;
        }

        // Add model_aliases if any are defined
        if (Object.keys(modelAliases).length > 0) {
          formValues.model_aliases = modelAliases;
        }

        const response: any = await teamCreateCall(accessToken, formValues);
        if (teams !== null) {
          setTeams([...teams, response]);
        } else {
          setTeams([response]);
        }
        console.log(`response for team create call: ${response}`);
        NotificationsManager.success(t("teams.teamCreated"));
        form.resetFields();
        setLoggingSettings([]);
        setModelAliases({});
        setIsTeamModalVisible(false);
      }
    } catch (error) {
      console.error("Error creating the team:", error);
      NotificationsManager.fromBackend(t("teams.errorCreatingTeam") + ": " + error);
    }
  };

  return (
    <Modal
      title={t("teams.createTeam")}
      open={isTeamModalVisible}
      width={1000}
      footer={null}
      onOk={handleOk}
      onCancel={handleCancel}
    >
      <Form form={form} onFinish={handleCreate} labelCol={{ span: 8 }} wrapperCol={{ span: 16 }} labelAlign="left">
        <>
          <Form.Item
            label={t("teams.teamName")}
            name="team_alias"
            rules={[
              {
                required: true,
                message: t("teams.pleaseInputTeamName"),
              },
            ]}
          >
            <TextInput placeholder="" />
          </Form.Item>
          <Form.Item
            label={
              <span>
                {t("teams.form.organization")}{" "}
                <Tooltip
                  title={
                    <span>
                      {t("teams.form.organizationTooltip")} {t("teams.form.learnMoreAbout")}
                      <a
                        href="https://docs.litellm.ai/docs/proxy/user_management_heirarchy"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          color: "#1890ff",
                          textDecoration: "underline",
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t("teams.form.userManagementHierarchy")}
                      </a>
                    </span>
                  }
                >
                  <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                </Tooltip>
              </span>
            }
            name="organization_id"
            initialValue={currentOrg ? currentOrg.organization_id : null}
            className="mt-8"
          >
            <Select2
              showSearch
              allowClear
              placeholder={t("teams.form.searchOrSelectOrg")}
              onChange={(value) => {
                form.setFieldValue("organization_id", value);
                setCurrentOrgForCreateTeam(organizations?.find((org) => org.organization_id === value) || null);
              }}
              filterOption={(input, option) => {
                if (!option) return false;
                const optionValue = option.children?.toString() || "";
                return optionValue.toLowerCase().includes(input.toLowerCase());
              }}
              optionFilterProp="children"
            >
              {organizations?.map((org) => (
                <Select2.Option key={org.organization_id} value={org.organization_id}>
                  <span className="font-medium">{org.organization_alias}</span>{" "}
                  <span className="text-gray-500">({org.organization_id})</span>
                </Select2.Option>
              ))}
            </Select2>
          </Form.Item>
          <Form.Item
            label={
              <span>
                {t("teams.form.models")}{" "}
                <Tooltip title={t("teams.form.modelsTooltip")}>
                  <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                </Tooltip>
              </span>
            }
            name="models"
          >
            <Select2 mode="multiple" placeholder={t("teams.form.selectModels")} style={{ width: "100%" }}>
              <Select2.Option key="all-proxy-models" value="all-proxy-models">
                {t("teams.form.allProxyModels")}
              </Select2.Option>
              {modelsToPick.map((model) => (
                <Select2.Option key={model} value={model}>
                  {getModelDisplayName(model)}
                </Select2.Option>
              ))}
            </Select2>
          </Form.Item>

          <Form.Item label={t("teams.form.maxBudgetUsd")} name="max_budget">
            <NumericalInput step={0.01} precision={2} width={200} />
          </Form.Item>
          <Form.Item className="mt-8" label={t("teams.form.resetBudget")} name="budget_duration">
            <Select2 defaultValue={null} placeholder={t("teams.form.na")}>
              <Select2.Option value="24h">{t("teams.form.daily")}</Select2.Option>
              <Select2.Option value="7d">{t("teams.form.weekly")}</Select2.Option>
              <Select2.Option value="30d">{t("teams.form.monthly")}</Select2.Option>
            </Select2>
          </Form.Item>
          <Form.Item label={t("teams.form.tpmLimit")} name="tpm_limit">
            <NumericalInput step={1} width={400} />
          </Form.Item>
          <Form.Item label={t("teams.form.rpmLimit")} name="rpm_limit">
            <NumericalInput step={1} width={400} />
          </Form.Item>

          <Accordion
            className="mt-20 mb-8"
            onClick={() => {
              if (!mcpAccessGroupsLoaded) {
                fetchMcpAccessGroups();
                setMcpAccessGroupsLoaded(true);
              }
            }}
          >
            <AccordionHeader>
              <b>{t("teams.form.additionalSettings")}</b>
            </AccordionHeader>
            <AccordionBody>
              <Form.Item
                label={t("teams.form.teamId")}
                name="team_id"
                help={t("teams.form.teamIdHelp")}
              >
                <TextInput
                  onChange={(e) => {
                    e.target.value = e.target.value.trim();
                  }}
                />
              </Form.Item>
              <Form.Item
                label={t("teams.form.teamMemberBudget")}
                name="team_member_budget"
                normalize={(value) => (value ? Number(value) : undefined)}
                tooltip={t("teams.form.teamMemberBudgetTooltip")}
              >
                <NumericalInput step={0.01} precision={2} width={200} />
              </Form.Item>
              <Form.Item
                label={t("teams.form.teamMemberKeyDuration")}
                name="team_member_key_duration"
                tooltip={t("teams.form.teamMemberKeyDurationTooltip")}
              >
                <TextInput placeholder="e.g., 30d" />
              </Form.Item>
              <Form.Item
                label={t("teams.form.teamMemberRpmLimit")}
                name="team_member_rpm_limit"
                tooltip={t("teams.form.teamMemberRpmLimitTooltip")}
              >
                <NumericalInput step={1} width={400} />
              </Form.Item>
              <Form.Item
                label={t("teams.form.teamMemberTpmLimit")}
                name="team_member_tpm_limit"
                tooltip={t("teams.form.teamMemberTpmLimitTooltip")}
              >
                <NumericalInput step={1} width={400} />
              </Form.Item>
              <Form.Item
                label={t("teams.form.metadata")}
                name="metadata"
                help={t("teams.form.metadataHelp")}
              >
                <Input.TextArea rows={4} />
              </Form.Item>
              <Form.Item
                label={t("teams.form.secretManagerSettings")}
                name="secret_manager_settings"
                help={
                  premiumUser
                    ? t("teams.form.secretManagerHelp")
                    : t("teams.form.premiumSecretManager")
                }
                rules={[
                  {
                    validator: async (_, value) => {
                      if (!value) {
                        return Promise.resolve();
                      }
                      try {
                        JSON.parse(value);
                        return Promise.resolve();
                      } catch (error) {
                        return Promise.reject(new Error(t("teams.form.pleaseEnterValidJson")));
                      }
                    },
                  },
                ]}
              >
                <Input.TextArea
                  rows={4}
                  placeholder='{"namespace": "admin", "mount": "secret", "path_prefix": "litellm"}'
                  disabled={!premiumUser}
                />
              </Form.Item>
              <Form.Item
                label={
                  <span>
                    {t("teams.form.guardrails")}{" "}
                    <Tooltip title={t("teams.form.setupFirstGuardrail")}>
                      <a
                        href="https://docs.litellm.ai/docs/proxy/guardrails/quick_start"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                      </a>
                    </Tooltip>
                  </span>
                }
                name="guardrails"
                className="mt-8"
                help={t("teams.form.selectExistingGuardrails")}
              >
                <Select2
                  mode="tags"
                  style={{ width: "100%" }}
                  placeholder={t("teams.form.selectOrEnterGuardrails")}
                  options={guardrailsList.map((name) => ({
                    value: name,
                    label: name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={
                  <span>
                    {t("teams.form.disableGlobalGuardrails")}{" "}
                    <Tooltip title={t("teams.form.disableGlobalGuardrailsTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="disable_global_guardrails"
                className="mt-4"
                valuePropName="checked"
                help={t("teams.form.bypassGlobalGuardrails")}
              >
                <Switch
                  checkedChildren="Yes"
                  unCheckedChildren="No"
                />
              </Form.Item>
              <Form.Item
                label={
                  <span>
                    {t("teams.form.policies")}{" "}
                    <Tooltip title={t("teams.form.policiesTooltip")}>
                      <a
                        href="https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                      </a>
                    </Tooltip>
                  </span>
                }
                name="policies"
                className="mt-8"
                help={t("teams.form.selectExistingPolicies")}
              >
                <Select2
                  mode="tags"
                  style={{ width: "100%" }}
                  placeholder={t("teams.form.selectOrEnterPolicies")}
                  options={policiesList.map((name) => ({
                    value: name,
                    label: name,
                  }))}
                />
              </Form.Item>
              <Form.Item
                label={
                  <span>
                    {t("teams.form.allowedVectorStores")}{" "}
                    <Tooltip title={t("teams.form.vectorStoresTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="allowed_vector_store_ids"
                className="mt-8"
                help={t("teams.form.selectVectorStoresHelp")}
              >
                <VectorStoreSelector
                  onChange={(values: string[]) => form.setFieldValue("allowed_vector_store_ids", values)}
                  value={form.getFieldValue("allowed_vector_store_ids")}
                  accessToken={accessToken || ""}
                  placeholder={t("teams.form.selectVectorStores")}
                />
              </Form.Item>
            </AccordionBody>
          </Accordion>

          <Accordion className="mt-8 mb-8">
            <AccordionHeader>
              <b>{t("teams.form.mcpSettings")}</b>
            </AccordionHeader>
            <AccordionBody>
              <Form.Item
                label={
                  <span>
                    {t("teams.form.allowedMcpServers")}{" "}
                    <Tooltip title={t("teams.form.mcpServersTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="allowed_mcp_servers_and_groups"
                className="mt-4"
                help={t("teams.form.selectMcpServersHelp")}
              >
                <MCPServerSelector
                  onChange={(val: any) => form.setFieldValue("allowed_mcp_servers_and_groups", val)}
                  value={form.getFieldValue("allowed_mcp_servers_and_groups")}
                  accessToken={accessToken || ""}
                  placeholder={t("teams.form.selectMcpServers")}
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
                      accessToken={accessToken || ""}
                      selectedServers={form.getFieldValue("allowed_mcp_servers_and_groups")?.servers || []}
                      toolPermissions={form.getFieldValue("mcp_tool_permissions") || {}}
                      onChange={(toolPerms) => form.setFieldsValue({ mcp_tool_permissions: toolPerms })}
                    />
                  </div>
                )}
              </Form.Item>
            </AccordionBody>
          </Accordion>

          <Accordion className="mt-8 mb-8">
            <AccordionHeader>
              <b>{t("teams.form.agentSettings")}</b>
            </AccordionHeader>
            <AccordionBody>
              <Form.Item
                label={
                  <span>
                    {t("teams.form.allowedAgents")}{" "}
                    <Tooltip title={t("teams.form.agentsTooltip")}>
                      <InfoCircleOutlined style={{ marginLeft: "4px" }} />
                    </Tooltip>
                  </span>
                }
                name="allowed_agents_and_groups"
                className="mt-4"
                help={t("teams.form.selectAgentsHelp")}
              >
                <AgentSelector
                  onChange={(val: any) => form.setFieldValue("allowed_agents_and_groups", val)}
                  value={form.getFieldValue("allowed_agents_and_groups")}
                  accessToken={accessToken || ""}
                  placeholder={t("teams.form.selectAgents")}
                />
              </Form.Item>
            </AccordionBody>
          </Accordion>

          <Accordion className="mt-8 mb-8">
            <AccordionHeader>
              <b>{t("teams.form.loggingSettings")}</b>
            </AccordionHeader>
            <AccordionBody>
              <div className="mt-4">
                <PremiumLoggingSettings
                  value={loggingSettings}
                  onChange={setLoggingSettings}
                  premiumUser={premiumUser}
                />
              </div>
            </AccordionBody>
          </Accordion>

          <Accordion className="mt-8 mb-8">
            <AccordionHeader>
              <b>{t("teams.form.modelAliases")}</b>
            </AccordionHeader>
            <AccordionBody>
              <div className="mt-4">
                <Text className="text-sm text-gray-600 mb-4">
                  {t("teams.form.modelAliasesDesc")}
                </Text>
                <ModelAliasManager
                  accessToken={accessToken || ""}
                  initialModelAliases={modelAliases}
                  onAliasUpdate={setModelAliases}
                  showExampleConfig={false}
                />
              </div>
            </AccordionBody>
          </Accordion>
        </>
        <div style={{ textAlign: "right", marginTop: "10px" }}>
          <Button2 htmlType="submit">{t("teams.createTeam")}</Button2>
        </div>
      </Form>
    </Modal>
  );
};

export default CreateTeamModal;
