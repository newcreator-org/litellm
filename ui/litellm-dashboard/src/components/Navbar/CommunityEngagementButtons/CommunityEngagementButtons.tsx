import { useDisableShowPrompts } from "@/app/(dashboard)/hooks/useDisableShowPrompts";
import { GithubOutlined, SlackOutlined } from "@ant-design/icons";
import { Button } from "antd";
import React from "react";
import { useTranslation } from "@/i18n";

export const CommunityEngagementButtons: React.FC = () => {
  const disableShowPrompts = useDisableShowPrompts();
  const { t } = useTranslation();

  // Hide buttons if prompts are disabled
  if (disableShowPrompts) {
    return null;
  }

  return (
    <>
      <Button
        href="https://www.litellm.ai/support"
        target="_blank"
        rel="noopener noreferrer"
        icon={<SlackOutlined />}
        className="shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/50 transition-shadow"
      >
        {t("navbar.joinSlack")}
      </Button>
      <Button
        href="https://github.com/BerriAI/litellm"
        target="_blank"
        rel="noopener noreferrer"
        className="shadow-md shadow-indigo-500/20 hover:shadow-indigo-500/50 transition-shadow"
        icon={<GithubOutlined />}
      >
        {t("navbar.starOnGithub")}
      </Button>
    </>
  );
};
