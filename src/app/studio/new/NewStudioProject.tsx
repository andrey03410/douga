"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { VideoAuthoringKind, VideoSubject } from "@douga/video/authoring";
import { studioRequest } from "../StudioWorkspace";
export function NewStudioProject({ sourceId }: { sourceId?: string }) {
  const router = useRouter();
  const [kind,setKind]=useState<VideoAuthoringKind>("top"), [subject,setSubject]=useState<VideoSubject | "auto">(sourceId ? "auto" : "characters"),
    [format,setFormat]=useState("wide"),[title,setTitle]=useState(""),[accent,setAccent]=useState("#efc47b"),
    [roundCount,setRoundCount]=useState(1),[cardsPerRound,setCardsPerRound]=useState(6),
    [error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <section className="panel">
    <h2>1. Тип ролика</h2>
    <div className="studio-toolbar" role="group" aria-label="Тип ролика">
      {([['top','Топ'],['picker','Пикер'],['tier-list','Тир-лист']] as const).map(([id,label])=><button key={id} className={`btn ${kind===id?'':'secondary'}`} aria-pressed={kind===id} onClick={()=>{setKind(id);if(id!=="top"&&(subject==="music"||subject==="auto"))setSubject("characters")}}>{label}</button>)}
    </div>
    <p className="muted">{kind==='top'?'Позиции от последней к первой. Крупный участник, место и название.':kind==='picker'?'Персонажи или группы: появление вариантов, затем время выбора.':'Готовое распределение по тирам: представление рядов и итоговая таблица.'}</p>
    {sourceId&&kind==='top'?<p className="studio-notice">Порядок и состав сегментов возьмём из вашего турнира. Оформление можно настроить отдельно.</p>:null}
    <h2>2. Состав и формат</h2>
    <div className="studio-toolbar">
      <label>Содержимое <select value={subject} onChange={e=>setSubject(e.target.value as VideoSubject | "auto")}>{sourceId&&kind==='top'?<option value="auto">По составу турнира</option>:null}<option value="characters">Персонажи</option><option value="anime">Аниме</option>{kind==='top'?<option value="music">Музыка / OST</option>:null}</select></label>
      <label>Формат кадра <select value={format} onChange={e=>setFormat(e.target.value)}><option value="wide">16:9 — широкий</option><option value="vertical">9:16 — вертикальный</option><option value="square">1:1 — квадратный</option></select></label>
      <label>Название <input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} placeholder="Название ролика" /></label>
    </div>
    {kind==='picker'?<div className="studio-toolbar"><label>Раундов <input type="number" min={1} max={1000} value={roundCount} onChange={e=>setRoundCount(Number(e.target.value))}/></label><label>Карточек в раунде <input type="number" min={2} max={12} value={cardsPerRound} onChange={e=>setCardsPerRound(Number(e.target.value))}/></label></div>:null}
    <h2>3. Оформление</h2><p className="muted">Начнём с проверенной композиции под состав ролика. Агент может выбрать шрифты, палитру и движение по вашему пожеланию, затем проверить реальные кадры.</p>
    <label>Цветовой акцент <input type="color" value={accent} onChange={e=>setAccent(e.target.value)}/></label>
    <p><a href={`/studio/recipes?kind=${kind==='tier-list'?'board':kind}`}>Посмотреть композиции и примерить оформление →</a></p>
    {error?<p className="error" role="alert">{error}</p>:null}
    <button className="btn" disabled={busy} onClick={async()=>{setBusy(true);setError("");try{const created=await studioRequest<{id:string}>("projects","POST",{kind,...(subject==='auto'?{}:{subject:kind==='top'?subject:subject==='music'?'characters':subject}),format,title:title||undefined,design:{accent},...(sourceId&&kind==='top'?{sourceId}:{}),...(kind==='picker'?{roundCount,cardsPerRound}:{}),idempotencyKey:crypto.randomUUID()});router.push(`/studio/${created.id}`)}catch(e){setError((e as Error).message);setBusy(false)}}}>{busy?'Создаём…':'Создать видео'}</button>
  </section>;
}
