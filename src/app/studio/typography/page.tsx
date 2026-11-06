import React from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/auth";
import { typographyFonts } from "@/video/font-manifest";
import { typographyStyles, typographyThemes } from "@/video/typography-catalog";
import TypographyGallery from "./TypographyGallery";
import "../studio.css";
import "./typography.css";

export default async function TypographyPage({
  searchParams,
}: {
  searchParams?: { project?: string };
}) {
  if (!(await currentUser())) redirect("/login");
  return (
    <main className="container type-page">
      <a
        className="type-back"
        href={
          searchParams?.project
            ? `/studio/${encodeURIComponent(searchParams.project)}`
            : "/projects"
        }
      >
        ← {searchParams?.project ? "К проекту" : "Мои видео"}
      </a>
      <header className="type-heading">
        <p className="type-eyebrow">DOUGA / TYPE STUDIO</p>
        <h1>
          У каждого имени
          <br />
          <span>свой характер.</span>
        </h1>
        <p>
          Примерьте шрифты на своих названиях. Красивые титры, читаемые подписи
          и японский текст — сразу в вашем видео.
        </p>
      </header>
      <TypographyGallery
        fonts={typographyFonts}
        themes={typographyThemes}
        styles={typographyStyles}
        projectId={searchParams?.project}
      />
    </main>
  );
}
