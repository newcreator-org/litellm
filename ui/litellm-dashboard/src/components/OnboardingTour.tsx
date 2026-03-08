"use client";

import React, { useCallback, useEffect, useState } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useTranslation } from "@/i18n";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Button } from "antd";

const ONBOARDING_STORAGE_KEY = "litellm_onboarding_completed";

/**
 * Build the tour steps using the current translation function.
 * Each step targets a CSS selector that exists in the rendered sidebar / navbar.
 */
function buildSteps(t: (key: string) => string): DriveStep[] {
  return [
    {
      popover: {
        title: t("onboarding.welcome.title"),
        description: t("onboarding.welcome.description"),
      },
    },
    {
      element: '[data-onboarding="sidebar"]',
      popover: {
        title: t("onboarding.sidebar.title"),
        description: t("onboarding.sidebar.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="api-keys"]',
      popover: {
        title: t("onboarding.virtualKeys.title"),
        description: t("onboarding.virtualKeys.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="models"]',
      popover: {
        title: t("onboarding.models.title"),
        description: t("onboarding.models.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="llm-playground"]',
      popover: {
        title: t("onboarding.playground.title"),
        description: t("onboarding.playground.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="new_usage"]',
      popover: {
        title: t("onboarding.usage.title"),
        description: t("onboarding.usage.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="teams"]',
      popover: {
        title: t("onboarding.teams.title"),
        description: t("onboarding.teams.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="logs"]',
      popover: {
        title: t("onboarding.logs.title"),
        description: t("onboarding.logs.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="settings"]',
      popover: {
        title: t("onboarding.settings.title"),
        description: t("onboarding.settings.description"),
        side: "right",
        align: "start",
      },
    },
    {
      element: '[data-onboarding="navbar"]',
      popover: {
        title: t("onboarding.navbar.title"),
        description: t("onboarding.navbar.description"),
        side: "bottom",
        align: "center",
      },
    },
    {
      popover: {
        title: t("onboarding.complete.title"),
        description: t("onboarding.complete.description"),
      },
    },
  ];
}

interface OnboardingTourProps {
  /** If true, auto-start the tour on first visit */
  autoStart?: boolean;
}

const OnboardingTour: React.FC<OnboardingTourProps> = ({ autoStart = true }) => {
  const { t } = useTranslation();
  const [hasCompleted, setHasCompleted] = useState(true); // default true to avoid flash

  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_STORAGE_KEY);
    setHasCompleted(completed === "true");
  }, []);

  const startTour = useCallback(() => {
    const steps = buildSteps(t);

    const driverObj = driver({
      showProgress: true,
      animate: true,
      allowClose: true,
      overlayColor: "rgba(0, 0, 0, 0.5)",
      stagePadding: 8,
      stageRadius: 8,
      popoverClass: "onboarding-popover",
      nextBtnText: t("onboarding.buttons.next"),
      prevBtnText: t("onboarding.buttons.prev"),
      doneBtnText: t("onboarding.buttons.done"),
      progressText: t("onboarding.buttons.progress"),
      onDestroyStarted: () => {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
        setHasCompleted(true);
        driverObj.destroy();
      },
      steps,
    });

    driverObj.drive();
  }, [t]);

  // Auto-start on first visit
  useEffect(() => {
    if (autoStart && !hasCompleted) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        startTour();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [autoStart, hasCompleted, startTour]);

  return (
    <Button
      type="text"
      icon={<QuestionCircleOutlined />}
      onClick={startTour}
      title={t("onboarding.helpButton")}
      style={{ color: "#6b7280" }}
    />
  );
};

export default OnboardingTour;
