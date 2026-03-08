import { useDisableBlogPosts } from "@/app/(dashboard)/hooks/useDisableBlogPosts";
import { useBlogPosts, type BlogPost } from "@/app/(dashboard)/hooks/blogPosts/useBlogPosts";
import { LoadingOutlined } from "@ant-design/icons";
import { Button, Dropdown, Space, Typography } from "antd";
import type { MenuProps } from "antd";
import React from "react";
import { useTranslation } from "@/i18n";

const { Text, Title, Paragraph } = Typography;

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const BlogDropdown: React.FC = () => {
  const disableBlogPosts = useDisableBlogPosts();

  const { data, isLoading, isError, refetch } = useBlogPosts();
  const { t } = useTranslation();

  if (disableBlogPosts) {
    return null;
  }

  let items: MenuProps["items"];

  if (isLoading) {
    items = [{ key: "loading", label: <LoadingOutlined />, disabled: true }];
  } else if (isError) {
    items = [
      {
        key: "error",
        label: (
          <Space>
            <Text type="danger">{t("navbar.failedToLoadPosts")}</Text>
            <Button size="small" onClick={() => refetch()}>
              {t("common.retry")}
            </Button>
          </Space>
        ),
        disabled: true,
      },
    ];
  } else if (!data || data.posts.length === 0) {
    items = [{ key: "empty", label: <Text type="secondary">{t("navbar.noPostsAvailable")}</Text>, disabled: true }];
  } else {
    items = [
      ...data.posts.slice(0, 5).map((post: BlogPost) => ({
        key: post.url,
        label: (
          <a href={post.url} target="_blank" rel="noopener noreferrer" style={{ display: "block", width: 380 }}>
            <Title level={5} style={{ marginBottom: 2 }}>
              {post.title}
            </Title>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {formatDate(post.date)}
            </Text>
            <Paragraph ellipsis={{ rows: 2 }}>{post.description}</Paragraph>
          </a>
        ),
      })),
      { type: "divider" as const },
      {
        key: "view-all",
        label: (
          <a href="https://docs.litellm.ai/blog" target="_blank" rel="noopener noreferrer">
            {t("navbar.viewAllPosts")}
          </a>
        ),
      },
    ];
  }

  return (
    <Dropdown menu={{ items }} trigger={["hover"]} placement="bottomRight">
      <Button type="text">{t("navbar.blog")}</Button>
    </Dropdown>
  );
};

export default BlogDropdown;
