import type { FontId } from "./typography-types";

/** Pinned, browser-safe metadata. Font bytes are read only by server/font loaders. */
export interface TypographyFontAsset {
  id: string;
  font: FontId;
  family: string;
  src: string;
  weight: 400 | 700;
  style: "normal" | "italic";
  hash: string;
  bytes: number;
  license: string;
  licenseHash: string;
  licenseBytes: number;
  source: string;
}
export interface TypographyFont {
  id: FontId;
  name: string;
  family: string;
  weights: readonly (400 | 700)[];
  italic: boolean;
  languages: readonly string[];
  faces: readonly string[];
}

export const typographyFontAssets: readonly TypographyFontAsset[] = [
  {
    "id": "arimo-400-normal",
    "font": "arimo",
    "family": "Douga Arimo",
    "src": "/fonts/typography-v1/arimo-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca",
    "bytes": 496268,
    "license": "/fonts/typography-v1/arimo-OFL.txt",
    "licenseHash": "11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/arimo/Arimo%5Bwght%5D.ttf"
  },
  {
    "id": "arimo-700-normal",
    "font": "arimo",
    "family": "Douga Arimo",
    "src": "/fonts/typography-v1/arimo-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "e43898b143ec826ac8cb4034816458a7047fbe0836558de2a1f8c6223ae3e0ca",
    "bytes": 496268,
    "license": "/fonts/typography-v1/arimo-OFL.txt",
    "licenseHash": "11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/arimo/Arimo%5Bwght%5D.ttf"
  },
  {
    "id": "arimo-400-italic",
    "font": "arimo",
    "family": "Douga Arimo",
    "src": "/fonts/typography-v1/arimo-italic.ttf",
    "weight": 400,
    "style": "italic",
    "hash": "a80fc54fd0233c1dfe298577c4d00f5ae81d5bb83510975e473c47e699b7f4ed",
    "bytes": 543196,
    "license": "/fonts/typography-v1/arimo-OFL.txt",
    "licenseHash": "11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/arimo/Arimo-Italic%5Bwght%5D.ttf"
  },
  {
    "id": "arimo-700-italic",
    "font": "arimo",
    "family": "Douga Arimo",
    "src": "/fonts/typography-v1/arimo-italic.ttf",
    "weight": 700,
    "style": "italic",
    "hash": "a80fc54fd0233c1dfe298577c4d00f5ae81d5bb83510975e473c47e699b7f4ed",
    "bytes": 543196,
    "license": "/fonts/typography-v1/arimo-OFL.txt",
    "licenseHash": "11cce536cd2f3864d767003af5dcd739e2e15818cf2279b6175edeadd3960992",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/arimo/Arimo-Italic%5Bwght%5D.ttf"
  },
  {
    "id": "manrope-400-normal",
    "font": "manrope",
    "family": "Douga Manrope",
    "src": "/fonts/typography-v1/manrope-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6",
    "bytes": 164700,
    "license": "/fonts/typography-v1/manrope-OFL.txt",
    "licenseHash": "58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b",
    "licenseBytes": 4387,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/manrope/Manrope%5Bwght%5D.ttf"
  },
  {
    "id": "manrope-700-normal",
    "font": "manrope",
    "family": "Douga Manrope",
    "src": "/fonts/typography-v1/manrope-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "3ae11c49db0455a3cc33e37d380f20fdb8c7f8b41dc07625c177e3d87a9d6ae6",
    "bytes": 164700,
    "license": "/fonts/typography-v1/manrope-OFL.txt",
    "licenseHash": "58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b",
    "licenseBytes": 4387,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/manrope/Manrope%5Bwght%5D.ttf"
  },
  {
    "id": "oswald-400-normal",
    "font": "oswald",
    "family": "Douga Oswald",
    "src": "/fonts/typography-v1/oswald-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817",
    "bytes": 172088,
    "license": "/fonts/typography-v1/oswald-OFL.txt",
    "licenseHash": "0fd731a904b729a4e02eaf5e8ebd06783edd9abe400e8882760160230675b652",
    "licenseBytes": 4483,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/oswald/Oswald%5Bwght%5D.ttf"
  },
  {
    "id": "oswald-700-normal",
    "font": "oswald",
    "family": "Douga Oswald",
    "src": "/fonts/typography-v1/oswald-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "5b38c246e255a12f5712d640d56bcced0472466fc68983d2d0410ec0457c2817",
    "bytes": 172088,
    "license": "/fonts/typography-v1/oswald-OFL.txt",
    "licenseHash": "0fd731a904b729a4e02eaf5e8ebd06783edd9abe400e8882760160230675b652",
    "licenseBytes": 4483,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/oswald/Oswald%5Bwght%5D.ttf"
  },
  {
    "id": "rubik-400-normal",
    "font": "rubik",
    "family": "Douga Rubik",
    "src": "/fonts/typography-v1/rubik-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "1b3a7437ba2af80e465e773ed60c5036d1ba6ace492d89046dbcf18fb31e4e88",
    "bytes": 359804,
    "license": "/fonts/typography-v1/rubik-OFL.txt",
    "licenseHash": "472cbe7c25441df63e9c7864b43eb3c0f4b3df950c66a76224e6cfe1eae843fb",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/rubik/Rubik%5Bwght%5D.ttf"
  },
  {
    "id": "rubik-700-normal",
    "font": "rubik",
    "family": "Douga Rubik",
    "src": "/fonts/typography-v1/rubik-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "1b3a7437ba2af80e465e773ed60c5036d1ba6ace492d89046dbcf18fb31e4e88",
    "bytes": 359804,
    "license": "/fonts/typography-v1/rubik-OFL.txt",
    "licenseHash": "472cbe7c25441df63e9c7864b43eb3c0f4b3df950c66a76224e6cfe1eae843fb",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/rubik/Rubik%5Bwght%5D.ttf"
  },
  {
    "id": "rubik-400-italic",
    "font": "rubik",
    "family": "Douga Rubik",
    "src": "/fonts/typography-v1/rubik-italic.ttf",
    "weight": 400,
    "style": "italic",
    "hash": "08c6c4018a5ada8b517407b46897e46cf6ebb106853fbd3e89addb51d3b59c62",
    "bytes": 354984,
    "license": "/fonts/typography-v1/rubik-OFL.txt",
    "licenseHash": "472cbe7c25441df63e9c7864b43eb3c0f4b3df950c66a76224e6cfe1eae843fb",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/rubik/Rubik-Italic%5Bwght%5D.ttf"
  },
  {
    "id": "rubik-700-italic",
    "font": "rubik",
    "family": "Douga Rubik",
    "src": "/fonts/typography-v1/rubik-italic.ttf",
    "weight": 700,
    "style": "italic",
    "hash": "08c6c4018a5ada8b517407b46897e46cf6ebb106853fbd3e89addb51d3b59c62",
    "bytes": 354984,
    "license": "/fonts/typography-v1/rubik-OFL.txt",
    "licenseHash": "472cbe7c25441df63e9c7864b43eb3c0f4b3df950c66a76224e6cfe1eae843fb",
    "licenseBytes": 4384,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/rubik/Rubik-Italic%5Bwght%5D.ttf"
  },
  {
    "id": "roboto-mono-400-normal",
    "font": "roboto-mono",
    "family": "Douga Roboto Mono",
    "src": "/fonts/typography-v1/roboto-mono-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "66a80e79d17e4c7cabd162e2916578a4cc08fd19eef6e2a643305eae9c567b2b",
    "bytes": 183700,
    "license": "/fonts/typography-v1/roboto-mono-OFL.txt",
    "licenseHash": "50ab8dd54680d3473f649c9db86fece88434d097c7834475c1c72d2f8c429215",
    "licenseBytes": 4395,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/robotomono/RobotoMono%5Bwght%5D.ttf"
  },
  {
    "id": "roboto-mono-700-normal",
    "font": "roboto-mono",
    "family": "Douga Roboto Mono",
    "src": "/fonts/typography-v1/roboto-mono-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "66a80e79d17e4c7cabd162e2916578a4cc08fd19eef6e2a643305eae9c567b2b",
    "bytes": 183700,
    "license": "/fonts/typography-v1/roboto-mono-OFL.txt",
    "licenseHash": "50ab8dd54680d3473f649c9db86fece88434d097c7834475c1c72d2f8c429215",
    "licenseBytes": 4395,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/robotomono/RobotoMono%5Bwght%5D.ttf"
  },
  {
    "id": "roboto-mono-400-italic",
    "font": "roboto-mono",
    "family": "Douga Roboto Mono",
    "src": "/fonts/typography-v1/roboto-mono-italic.ttf",
    "weight": 400,
    "style": "italic",
    "hash": "49ac343bb7b070071e53f0a8a501d68d140ed98ebd0a43b6b8fb96cf22f09ff7",
    "bytes": 196792,
    "license": "/fonts/typography-v1/roboto-mono-OFL.txt",
    "licenseHash": "50ab8dd54680d3473f649c9db86fece88434d097c7834475c1c72d2f8c429215",
    "licenseBytes": 4395,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/robotomono/RobotoMono-Italic%5Bwght%5D.ttf"
  },
  {
    "id": "roboto-mono-700-italic",
    "font": "roboto-mono",
    "family": "Douga Roboto Mono",
    "src": "/fonts/typography-v1/roboto-mono-italic.ttf",
    "weight": 700,
    "style": "italic",
    "hash": "49ac343bb7b070071e53f0a8a501d68d140ed98ebd0a43b6b8fb96cf22f09ff7",
    "bytes": 196792,
    "license": "/fonts/typography-v1/roboto-mono-OFL.txt",
    "licenseHash": "50ab8dd54680d3473f649c9db86fece88434d097c7834475c1c72d2f8c429215",
    "licenseBytes": 4395,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/robotomono/RobotoMono-Italic%5Bwght%5D.ttf"
  },
  {
    "id": "noto-sans-jp-400-normal",
    "font": "noto-sans-jp",
    "family": "Douga Noto Sans JP",
    "src": "/fonts/typography-v1/noto-sans-jp-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
    "bytes": 9589900,
    "license": "/fonts/typography-v1/noto-sans-jp-OFL.txt",
    "licenseHash": "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9",
    "licenseBytes": 4388,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
  },
  {
    "id": "noto-sans-jp-700-normal",
    "font": "noto-sans-jp",
    "family": "Douga Noto Sans JP",
    "src": "/fonts/typography-v1/noto-sans-jp-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
    "bytes": 9589900,
    "license": "/fonts/typography-v1/noto-sans-jp-OFL.txt",
    "licenseHash": "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9",
    "licenseBytes": 4388,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
  },
  {
    "id": "noto-serif-jp-400-normal",
    "font": "noto-serif-jp",
    "family": "Douga Noto Serif JP",
    "src": "/fonts/typography-v1/noto-serif-jp-normal.ttf",
    "weight": 400,
    "style": "normal",
    "hash": "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc",
    "bytes": 13574352,
    "license": "/fonts/typography-v1/noto-serif-jp-OFL.txt",
    "licenseHash": "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6",
    "licenseBytes": 4350,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf"
  },
  {
    "id": "noto-serif-jp-700-normal",
    "font": "noto-serif-jp",
    "family": "Douga Noto Serif JP",
    "src": "/fonts/typography-v1/noto-serif-jp-normal.ttf",
    "weight": 700,
    "style": "normal",
    "hash": "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc",
    "bytes": 13574352,
    "license": "/fonts/typography-v1/noto-serif-jp-OFL.txt",
    "licenseHash": "5e0da210fb04058a8c0087985d2d456b931c2579811a49655721d3cf0c36b6d6",
    "licenseBytes": 4350,
    "source": "https://raw.githubusercontent.com/google/fonts/38411257417e616c5d4daa1b9e91a3dbcebe1c2e/ofl/notoserifjp/NotoSerifJP%5Bwght%5D.ttf"
  }
];
export const typographyFonts: readonly TypographyFont[] = [
  {
    "id": "arimo",
    "name": "Arimo",
    "family": "Douga Arimo",
    "weights": [
      400,
      700
    ],
    "italic": true,
    "languages": [
      "en",
      "ru"
    ],
    "faces": [
      "arimo-400-normal",
      "arimo-700-normal",
      "arimo-400-italic",
      "arimo-700-italic"
    ]
  },
  {
    "id": "manrope",
    "name": "Manrope",
    "family": "Douga Manrope",
    "weights": [
      400,
      700
    ],
    "italic": false,
    "languages": [
      "en",
      "ru"
    ],
    "faces": [
      "manrope-400-normal",
      "manrope-700-normal"
    ]
  },
  {
    "id": "oswald",
    "name": "Oswald",
    "family": "Douga Oswald",
    "weights": [
      400,
      700
    ],
    "italic": false,
    "languages": [
      "en",
      "ru"
    ],
    "faces": [
      "oswald-400-normal",
      "oswald-700-normal"
    ]
  },
  {
    "id": "rubik",
    "name": "Rubik",
    "family": "Douga Rubik",
    "weights": [
      400,
      700
    ],
    "italic": true,
    "languages": [
      "en",
      "ru"
    ],
    "faces": [
      "rubik-400-normal",
      "rubik-700-normal",
      "rubik-400-italic",
      "rubik-700-italic"
    ]
  },
  {
    "id": "roboto-mono",
    "name": "Roboto Mono",
    "family": "Douga Roboto Mono",
    "weights": [
      400,
      700
    ],
    "italic": true,
    "languages": [
      "en",
      "ru"
    ],
    "faces": [
      "roboto-mono-400-normal",
      "roboto-mono-700-normal",
      "roboto-mono-400-italic",
      "roboto-mono-700-italic"
    ]
  },
  {
    "id": "noto-sans-jp",
    "name": "Noto Sans JP",
    "family": "Douga Noto Sans JP",
    "weights": [
      400,
      700
    ],
    "italic": false,
    "languages": [
      "en",
      "ru",
      "ja"
    ],
    "faces": [
      "noto-sans-jp-400-normal",
      "noto-sans-jp-700-normal"
    ]
  },
  {
    "id": "noto-serif-jp",
    "name": "Noto Serif JP",
    "family": "Douga Noto Serif JP",
    "weights": [
      400,
      700
    ],
    "italic": false,
    "languages": [
      "en",
      "ru",
      "ja"
    ],
    "faces": [
      "noto-serif-jp-400-normal",
      "noto-serif-jp-700-normal"
    ]
  }
];

export function getFontFace(id: string): TypographyFontAsset | undefined {
  return typographyFontAssets.find((face) => face.id === id);
}
export function supportsFontFace(font: string, weight: number, italic: boolean): boolean {
  return !!getFontFace(`${font}-${weight}-${italic ? "italic" : "normal"}`);
}
