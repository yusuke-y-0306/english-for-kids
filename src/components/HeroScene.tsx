/**
 * HeroScene — トップページのメインビジュアル（SVG）
 *
 * 参照イメージ（Issue #16）に合わせて、空・虹・丘・学校・顔のある木・
 * アルファベットが浮かぶ世界観を、画像アセットを使わず SVG で描いています。
 * 画面幅に応じて object-contain で拡大縮小されるため、
 * どのサイズでも線がにじみません。
 */
export default function HeroScene({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 640"
      role="img"
      aria-label="虹と丘の広がる野原を、本を持ったクマとウサギが歩いているイラスト"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="hero-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bfe9ff" />
          <stop offset="55%" stopColor="#ddf4ff" />
          <stop offset="100%" stopColor="#f4fcef" />
        </linearGradient>
        <linearGradient id="hero-meadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a8e07a" />
          <stop offset="100%" stopColor="#79c952" />
        </linearGradient>
        <linearGradient id="hero-meadow-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c9ee9d" />
          <stop offset="100%" stopColor="#a3de74" />
        </linearGradient>
        <linearGradient id="hero-path" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7ebd3" />
          <stop offset="100%" stopColor="#e6d5b8" />
        </linearGradient>
        <radialGradient id="hero-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fff3b0" stopOpacity="0.95" />
          <stop offset="70%" stopColor="#ffe98a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffe98a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 空 */}
      <rect width="1200" height="640" fill="url(#hero-sky)" />
      <circle cx="150" cy="80" r="120" fill="url(#hero-sun)" />

      {/* 雲 */}
      <g fill="#ffffff" opacity="0.92">
        <g transform="translate(150 96)">
          <ellipse cx="0" cy="0" rx="46" ry="26" />
          <ellipse cx="40" cy="6" rx="34" ry="20" />
          <ellipse cx="-38" cy="8" rx="30" ry="18" />
        </g>
        <g transform="translate(700 62) scale(0.85)">
          <ellipse cx="0" cy="0" rx="46" ry="26" />
          <ellipse cx="36" cy="8" rx="32" ry="19" />
          <ellipse cx="-40" cy="9" rx="28" ry="17" />
        </g>
        <g transform="translate(1060 140) scale(0.7)">
          <ellipse cx="0" cy="0" rx="46" ry="26" />
          <ellipse cx="38" cy="7" rx="30" ry="18" />
        </g>
      </g>

      {/* 虹 */}
      <g fill="none" strokeWidth="18" strokeLinecap="round" opacity="0.95">
        <path d="M760 392a220 220 0 0 1 440 0" stroke="#ff6b6b" />
        <path d="M782 392a198 198 0 0 1 396 0" stroke="#ff9f43" />
        <path d="M804 392a176 176 0 0 1 352 0" stroke="#ffd93d" />
        <path d="M826 392a154 154 0 0 1 308 0" stroke="#6cc24a" />
        <path d="M848 392a132 132 0 0 1 264 0" stroke="#4dc9f6" />
        <path d="M870 392a110 110 0 0 1 220 0" stroke="#a17bf0" />
      </g>

      {/* 遠くの丘 */}
      <path
        d="M0 400c120-70 210-58 320-30 90 22 170 8 250-24 110-44 220-30 330 14 90 36 200 40 300 22v258H0Z"
        fill="url(#hero-meadow-far)"
      />
      {/* 手前の丘 */}
      <path
        d="M0 470c150-80 280-70 400-34 120 36 220 20 320-26 120-56 250-40 480 40v190H0Z"
        fill="url(#hero-meadow)"
      />

      {/* 学校 */}
      <g transform="translate(92 236)">
        <rect x="0" y="52" width="196" height="126" rx="10" fill="#fff6e6" />
        <path d="M-14 54 98 0l112 54Z" fill="#ff8a5c" />
        <rect x="76" y="120" width="44" height="58" rx="6" fill="#c98b5e" />
        <circle cx="112" cy="150" r="3.5" fill="#fff3c4" />
        <g fill="#bfe6ff" stroke="#8ec9ef" strokeWidth="3">
          <rect x="20" y="76" width="38" height="32" rx="5" />
          <rect x="140" y="76" width="38" height="32" rx="5" />
        </g>
        <rect x="58" y="16" width="80" height="30" rx="8" fill="#8a5a3b" />
        <text
          x="98"
          y="37"
          textAnchor="middle"
          fontFamily="var(--font-fredoka), sans-serif"
          fontSize="17"
          fontWeight="600"
          fill="#fff8ec"
          letterSpacing="1"
        >
          SCHOOL
        </text>
      </g>

      {/* 顔のある木 */}
      <g transform="translate(340 210)">
        <path
          d="M18 240V132h30v108Z"
          fill="#b07a4e"
        />
        <circle cx="33" cy="96" r="76" fill="#5fb84f" />
        <circle cx="-32" cy="126" r="52" fill="#6ec95c" />
        <circle cx="98" cy="126" r="52" fill="#6ec95c" />
        <circle cx="33" cy="40" r="44" fill="#7ed468" />
        {/* 木の幹の顔 */}
        <g transform="translate(33 176)">
          <ellipse cx="0" cy="0" rx="17" ry="19" fill="#f7e3cd" opacity="0.85" />
          <circle cx="-6.5" cy="-3" r="2.6" fill="#5c3d28" />
          <circle cx="6.5" cy="-3" r="2.6" fill="#5c3d28" />
          <path
            d="M-6 7q6 6 12 0"
            stroke="#5c3d28"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      </g>

      {/* 小道 */}
      <path
        d="M600 430c-40 40-48 60-96 92-46 32-104 52-150 118h420c-30-70-96-92-134-134-22-24-26-30-24-52 2-14 0-16-16-24Z"
        fill="url(#hero-path)"
        opacity="0.95"
      />

      {/* 浮かぶアルファベット */}
      <g fontFamily="var(--font-fredoka), sans-serif" fontWeight="600">
        <text x="452" y="150" fontSize="58" fill="#ff8fb0" transform="rotate(-12 452 150)">
          A
        </text>
        <text x="548" y="96" fontSize="48" fill="#4dc9f6" transform="rotate(9 548 96)">
          B
        </text>
        <text x="640" y="168" fontSize="52" fill="#ffb03a" transform="rotate(-6 640 168)">
          C
        </text>
        <text x="330" y="112" fontSize="44" fill="#a17bf0" transform="rotate(14 330 112)">
          D
        </text>
      </g>

      {/* ことばのふきだし */}
      <g fontFamily="var(--font-fredoka), sans-serif" fontWeight="600">
        <g transform="rotate(-7 250 200)">
          <rect x="196" y="176" width="104" height="46" rx="23" fill="#fff8ec" />
          <text x="248" y="207" textAnchor="middle" fontSize="24" fill="#ff6b6b">
            CAT
          </text>
        </g>
        <g transform="rotate(6 800 224)">
          <rect x="746" y="200" width="108" height="46" rx="23" fill="#fff8ec" />
          <text x="800" y="231" textAnchor="middle" fontSize="24" fill="#a17bf0">
            DOG
          </text>
        </g>
        <g transform="rotate(-4 1046 128)">
          <rect x="968" y="104" width="156" height="46" rx="23" fill="#fff8ec" />
          <text x="1046" y="135" textAnchor="middle" fontSize="24" fill="#6cc24a">
            LEARN
          </text>
        </g>
        <g transform="rotate(8 900 320)">
          <rect x="854" y="296" width="96" height="46" rx="23" fill="#fff8ec" />
          <text x="902" y="327" textAnchor="middle" fontSize="24" fill="#4dc9f6">
            FUN
          </text>
        </g>
      </g>

      {/* 星とかがやき */}
      <g fill="#fff6b0">
        <g className="anim-twinkle" style={{ animationDelay: "0s" }}>
          <path d="M700 250l7 16 17 2-13 12 3 17-14-9-15 9 4-17-13-12 17-2Z" />
        </g>
        <g className="anim-twinkle" style={{ animationDelay: "1.1s" }}>
          <path d="M1010 250l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2Z" />
        </g>
        <g className="anim-twinkle" style={{ animationDelay: "2.2s" }}>
          <path d="M380 300l6 14 15 2-11 10 3 15-13-8-13 8 3-15-11-10 15-2Z" />
        </g>
      </g>

      {/* シャボン玉 */}
      <g fill="#ffffff" opacity="0.55">
        <circle className="anim-bubble" cx="1090" cy="330" r="12" />
        <circle className="anim-bubble" cx="1130" cy="360" r="8" style={{ animationDelay: "1.6s" }} />
        <circle className="anim-bubble" cx="300" cy="330" r="10" style={{ animationDelay: "2.8s" }} />
        <circle className="anim-bubble" cx="250" cy="360" r="7" style={{ animationDelay: "4.1s" }} />
      </g>

      {/* クマ（Buddy） */}
      <ellipse cx="491" cy="562" rx="98" ry="15" fill="#3f7a2a" opacity="0.18" />
      {/* NOTE: CSS の transform (アニメーション) は SVG の transform 属性より優先される。
          そのため「位置」と「ゆれ」は別の <g> に分ける (同じ要素に持たせると
          キャラクターが原点付近に吹き飛ぶ)。 */}
      <g transform="translate(409 300)">
        <g className="anim-step">
        {/* 脚 */}
        <g>
          <rect x="34" y="196" width="30" height="56" rx="15" fill="#86593a" />
          <rect x="96" y="190" width="30" height="60" rx="15" fill="#86593a" />
          <ellipse cx="46" cy="256" rx="30" ry="16" fill="#4dc9f6" />
          <ellipse cx="112" cy="254" rx="30" ry="16" fill="#ff8fb0" />
        </g>
        {/* 体 */}
        <ellipse cx="86" cy="150" rx="66" ry="72" fill="#a9744f" />
        {/* 虹色スカーフ */}
        <g>
          <rect x="34" y="96" width="104" height="14" rx="7" fill="#ff6b6b" />
          <rect x="36" y="110" width="98" height="12" rx="6" fill="#ffd93d" />
          <rect x="38" y="122" width="92" height="12" rx="6" fill="#4dc9f6" />
          <rect x="44" y="134" width="40" height="34" rx="10" fill="#ff9f43" />
        </g>
        {/* 腕（本を抱える） */}
        <g>
          <ellipse cx="146" cy="150" rx="22" ry="34" fill="#8f6142" transform="rotate(-18 146 150)" />
          {/* 赤い本 */}
          <g transform="rotate(8 178 186)">
            <rect x="146" y="158" width="64" height="52" rx="7" fill="#ff5d5d" />
            <rect x="152" y="164" width="52" height="40" rx="4" fill="#fff8ec" />
            <text
              x="178"
              y="192"
              textAnchor="middle"
              fontFamily="var(--font-fredoka), sans-serif"
              fontSize="17"
              fontWeight="600"
              fill="#ff5d5d"
            >
              ABC
            </text>
          </g>
        </g>
        {/* 頭 */}
        <g transform="translate(86 34)">
          <circle cx="-46" cy="-32" r="21" fill="#8f6142" />
          <circle cx="46" cy="-32" r="21" fill="#8f6142" />
          <circle cx="-46" cy="-32" r="11" fill="#f7e3cd" />
          <circle cx="46" cy="-32" r="11" fill="#f7e3cd" />
          <circle cx="0" cy="0" r="64" fill="#a9744f" />
          {/* ヘッドバンド */}
          <path
            d="M-62 -22a62 62 0 0 1 124 0"
            fill="none"
            stroke="#4dc9f6"
            strokeWidth="20"
            strokeLinecap="round"
          />
          <rect x="-52" y="-40" width="104" height="18" rx="9" fill="#2f8fbf" />
          <text
            x="0"
            y="-26.5"
            textAnchor="middle"
            fontFamily="var(--font-fredoka), sans-serif"
            fontSize="10"
            fontWeight="600"
            fill="#eafaff"
            letterSpacing="0.4"
          >
            ENGLISH ADVENTURE
          </text>
          {/* 顔 */}
          <ellipse cx="0" cy="18" rx="38" ry="30" fill="#f7e3cd" />
          <circle cx="-22" cy="-4" r="5.4" fill="#3d3229" />
          <circle cx="22" cy="-4" r="5.4" fill="#3d3229" />
          <circle cx="-20" cy="-6" r="1.8" fill="#fff" />
          <circle cx="24" cy="-6" r="1.8" fill="#fff" />
          <ellipse cx="-38" cy="12" rx="8" ry="5.5" fill="#ffb3c7" opacity="0.8" />
          <ellipse cx="38" cy="12" rx="8" ry="5.5" fill="#ffb3c7" opacity="0.8" />
          <ellipse cx="0" cy="12" rx="7.5" ry="6" fill="#5c3d28" />
          <path
            d="M-12 22q12 12 24 0"
            stroke="#5c3d28"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        </g>
        </g>
      </g>

      {/* ウサギ */}
      <ellipse cx="705" cy="556" rx="70" ry="12" fill="#3f7a2a" opacity="0.18" />
      <g transform="translate(639 344)">
        <g className="anim-step" style={{ animationDelay: "0.6s" }}>
        {/* 脚 */}
        <rect x="26" y="160" width="24" height="46" rx="12" fill="#f0e6ea" />
        <rect x="74" y="156" width="24" height="50" rx="12" fill="#f0e6ea" />
        <ellipse cx="38" cy="208" rx="26" ry="14" fill="#ff9f43" />
        <ellipse cx="86" cy="206" rx="26" ry="14" fill="#a17bf0" />
        {/* 体 */}
        <ellipse cx="66" cy="122" rx="52" ry="56" fill="#ffffff" stroke="#e8dde2" strokeWidth="2" />
        {/* 本 */}
        <g transform="rotate(-6 66 132)">
          <rect x="24" y="104" width="86" height="54" rx="7" fill="#ff9f43" />
          <rect x="31" y="110" width="72" height="42" rx="4" fill="#fff8ec" />
          <text
            x="67"
            y="129"
            textAnchor="middle"
            fontFamily="var(--font-fredoka), sans-serif"
            fontSize="10"
            fontWeight="600"
            fill="#e0761f"
          >
            LEARN
          </text>
          <text
            x="67"
            y="143"
            textAnchor="middle"
            fontFamily="var(--font-fredoka), sans-serif"
            fontSize="10"
            fontWeight="600"
            fill="#e0761f"
          >
            ENGLISH
          </text>
        </g>
        {/* 腕 */}
        <ellipse cx="16" cy="120" rx="15" ry="24" fill="#ffffff" stroke="#e8dde2" strokeWidth="2" transform="rotate(14 16 120)" />
        <ellipse cx="116" cy="120" rx="15" ry="24" fill="#ffffff" stroke="#e8dde2" strokeWidth="2" transform="rotate(-14 116 120)" />
        {/* 頭 */}
        <g transform="translate(66 18)">
          <g className="anim-sway" style={{ animationDelay: "0.3s" }}>
            <ellipse cx="-18" cy="-58" rx="14" ry="42" fill="#ffffff" stroke="#e8dde2" strokeWidth="2" transform="rotate(-10 -18 -58)" />
            <ellipse cx="-18" cy="-58" rx="7" ry="30" fill="#ffc9d8" transform="rotate(-10 -18 -58)" />
            <ellipse cx="18" cy="-58" rx="14" ry="42" fill="#ffffff" stroke="#e8dde2" strokeWidth="2" transform="rotate(10 18 -58)" />
            <ellipse cx="18" cy="-58" rx="7" ry="30" fill="#ffc9d8" transform="rotate(10 18 -58)" />
          </g>
          <circle cx="0" cy="0" r="50" fill="#ffffff" stroke="#e8dde2" strokeWidth="2" />
          <circle cx="-19" cy="-1" r="5" fill="#3d3229" />
          <circle cx="19" cy="-1" r="5" fill="#3d3229" />
          <circle cx="-17.5" cy="-3" r="1.7" fill="#fff" />
          <circle cx="20.5" cy="-3" r="1.7" fill="#fff" />
          <ellipse cx="-31" cy="11" rx="7.5" ry="5" fill="#ffb3c7" opacity="0.85" />
          <ellipse cx="31" cy="11" rx="7.5" ry="5" fill="#ffb3c7" opacity="0.85" />
          <path
            d="M0 8l5 6-5 5-5-5Z"
            fill="#ff8fb0"
          />
          <path
            d="M-11 24q11 10 22 0"
            stroke="#5c3d28"
            strokeWidth="2.8"
            fill="none"
            strokeLinecap="round"
          />
        </g>
        </g>
      </g>

      {/* 手前の小物 */}
      <g>
        {/* アルファベット積み木 */}
        <g transform="translate(120 520)">
          <rect x="0" y="0" width="56" height="56" rx="10" fill="#ffd93d" />
          <rect x="8" y="8" width="40" height="40" rx="7" fill="#fff3b0" />
          <text
            x="28"
            y="38"
            textAnchor="middle"
            fontFamily="var(--font-fredoka), sans-serif"
            fontSize="26"
            fontWeight="600"
            fill="#e08c1c"
          >
            A
          </text>
        </g>
        <g transform="translate(66 552)">
          <rect x="0" y="0" width="52" height="52" rx="9" fill="#4dc9f6" />
          <rect x="7" y="7" width="38" height="38" rx="6" fill="#d8f4ff" />
          <text
            x="26"
            y="34"
            textAnchor="middle"
            fontFamily="var(--font-fredoka), sans-serif"
            fontSize="24"
            fontWeight="600"
            fill="#2e9ec4"
          >
            B
          </text>
        </g>
        {/* 地球儀 */}
        <g transform="translate(1010 512)">
          <circle cx="0" cy="0" r="44" fill="#4dc9f6" />
          <path d="M-30 -12q16 10 34 2 14-6 26 6" stroke="#6cc24a" strokeWidth="9" fill="none" strokeLinecap="round" />
          <path d="M-34 16q18 12 40 4" stroke="#6cc24a" strokeWidth="8" fill="none" strokeLinecap="round" />
          <rect x="-72" y="40" width="144" height="16" rx="8" fill="#c98b5e" />
        </g>
        {/* ひらいた本 */}
        <g transform="translate(880 560)">
          <path d="M0 0q34-16 68 0v44q-34-16-68 0Z" fill="#fff8ec" stroke="#e0cba8" strokeWidth="4" />
          <path d="M68 0q34-16 68 0v44q-34-16-68 0Z" fill="#fff8ec" stroke="#e0cba8" strokeWidth="4" />
          <path d="M68 0v44" stroke="#e0cba8" strokeWidth="4" />
          <path d="M14 16h40M14 28h34M82 16h40M82 28h34" stroke="#e8d9bd" strokeWidth="4" strokeLinecap="round" />
        </g>
        {/* えんぴつ */}
        <g transform="translate(1120 570) rotate(-24)">
          <rect x="0" y="0" width="14" height="72" rx="3" fill="#ffd93d" />
          <path d="M0 72l7 16 7-16Z" fill="#f7e3cd" />
          <path d="M4.5 82l2.5 6 2.5-6Z" fill="#3d3229" />
          <rect x="0" y="0" width="14" height="10" rx="3" fill="#ff8fb0" />
        </g>
      </g>
    </svg>
  );
}
