import React from "react";
import { useTranslation } from "@/i18n";
import { Code } from "lucide-react";
import { NudgePrompt } from "./NudgePrompt";

interface ClaudeCodePromptProps {
  onOpen: () => void;
  onDismiss: () => void;
  isVisible: boolean;
}

export function ClaudeCodePrompt({ onOpen, onDismiss, isVisible }: ClaudeCodePromptProps) {
  const { t } = useTranslation();
  return (
    <NudgePrompt
      onOpen={onOpen}
      onDismiss={onDismiss}
      isVisible={isVisible}
      title={t("survey.claudeCodeTitle")}
      description={t("survey.claudeCodeDescription")}
      buttonText={t("survey.shareFeedback")}
      icon={Code}
      accentColor="#7c3aed"
      buttonStyle={{ backgroundColor: '#7c3aed', borderColor: '#7c3aed' }}
    />
  );
}

