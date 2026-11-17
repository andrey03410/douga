import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { NewStudioProject } from "./NewStudioProject";
vi.mock("next/navigation",()=>({useRouter:()=>({push(){}})}));
it("starts creation with a semantic type and preserves the tournament source choice",()=>{
 const html=renderToStaticMarkup(React.createElement(NewStudioProject,{sourceId:"owned-tournament"}));
 expect(html).toContain('aria-label="Тип ролика"');
 expect(html).toContain('aria-pressed="true">Топ');
 expect(html).toContain('Тир-лист');
 expect(html).toContain('из вашего турнира');
 expect(html).not.toContain('VideoDocument');
 expect(html).not.toContain('top.classic');
});
