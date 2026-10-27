import { redirect } from "next/navigation";
import { auth } from "@/auth";

const FEATURES = [
  {
    icon: "🏆",
    title: "Видео-топы",
    text: "Рейтинг опенингов, OST или персонажей превращается в ролик: интро, плашки, свой фрагмент трека на каждую позицию.",
  },
  {
    icon: "🎯",
    title: "Пикеры",
    text: "«Выбери персонажа» или «блок против блока»: раунды с карточками, таймер-кольцо и подсветка ответа.",
  },
  {
    icon: "⚔️",
    title: "Честные турниры",
    text: "Попарные и групповые сравнения треков, при желании вслепую: швейцарка, круговая или сортировка строят рейтинг за вас.",
  },
  {
    icon: "🌸",
    title: "Shikimori",
    text: "Постеры аниме и персонажей, ваши списки и избранное — прямо в пул медиа, без ручного поиска картинок.",
  },
  {
    icon: "✨",
    title: "ИИ-студия",
    text: "Внешний ИИ через MCP собирает и оформляет ролик по вашему запросу; вы правите тот же документ и смотрите превью.",
  },
  {
    icon: "📼",
    title: "Рендер в MP4",
    text: "16:9, 9:16 или 1:1 — готовый файл для YouTube, Shorts и соцсетей.",
  },
];

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/tournaments");

  return (
    <div className="container">
      <section className="welcome-hero panel">
        <h1>Аниме-ролики из ваших рейтингов</h1>
        <p className="muted" style={{ fontSize: 17, maxWidth: 640 }}>
          Douga собирает видео-топы и пикеры в аниме-тематике: честный рейтинг
          из сравнений, постеры из Shikimori, музыка и клипы из вашего пула —
          и готовый MP4 на выходе. Оформление можно доверить ИИ.
        </p>
        <div className="row" style={{ gap: 12, marginTop: 18 }}>
          <a className="btn" href="/login">
            Войти
          </a>
          <a className="btn ghost" href="/login?mode=register">
            Зарегистрироваться
          </a>
        </div>
      </section>

      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div className="panel feature-card" key={f.title}>
            <div style={{ fontSize: 28 }}>{f.icon}</div>
            <h3>{f.title}</h3>
            <p className="muted">{f.text}</p>
          </div>
        ))}
      </section>

      <p className="muted" style={{ textAlign: "center", margin: "24px 0" }}>
        Контент виден только после входа. Зарегистрируйтесь — это бесплатно —
        и соберите свой первый ролик за вечер.
      </p>
    </div>
  );
}
