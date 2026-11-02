import { rect, palette } from "./overlay-kit.js";

function surface(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}
function polygon(ctx, points, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

/** Cached procedural scenery. The entire upper 720px stays transparent. */
export function courtyard() {
  const { canvas, ctx } = surface(1920, 360);
  rect(ctx, 0, 0, 1920, 360, "#252837");
  // Distant crenellated wall, masonry, grass growing between courtyard stones.
  rect(ctx, 0, 0, 1920, 80, "#353747");
  for (let x = 0; x < 1920; x += 48) {
    rect(ctx, x, 0, 28, 20, "#555368");
    rect(ctx, x + 3, 3, 22, 5, "#787082");
  }
  for (let row = 0; row < 4; row++) {
    for (let x = -50; x < 1920; x += 90) {
      rect(
        ctx,
        x + (row % 2) * 45,
        27 + row * 16,
        87,
        13,
        row % 2 ? "#424152" : "#3b3b4d",
      );
    }
  }
  rect(ctx, 0, 84, 1920, 8, "#787080");
  rect(ctx, 0, 92, 1920, 6, "#171e2b");
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 26; col++) {
      const x = col * 80 - (row % 2) * 40,
        y = 103 + row * 30;
      rect(
        ctx,
        x + 2,
        y,
        76,
        26,
        (row + col) % 3 === 0 ? "#333544" : "#2e3040",
      );
      rect(ctx, x + 5, y, 68, 2, "#444351");
      if ((row * 7 + col) % 13 === 0)
        rect(ctx, x + 7, y + 23, 10, 3, "#526158");
    }
  }
  for (const x of [20, 1370, 1880]) {
    rect(ctx, x, 0, 24, 99, "#4f4a5b");
    rect(ctx, x - 5, 0, 34, 8, "#8e7a80");
    rect(ctx, x + 6, 35, 12, 34, "#201e2c");
    rect(ctx, x + 3, 38, 18, 13, "#d18351");
    rect(ctx, x + 7, 32, 10, 16, "#ffdb8b");
  }
  // Heraldic pennants hanging off the wall.
  for (const x of [330, 950, 1510, 1770]) {
    polygon(
      ctx,
      [
        [x, 14],
        [x + 36, 14],
        [x + 36, 66],
        [x + 18, 79],
        [x, 66],
      ],
      "#754b62",
    );
    rect(ctx, x + 16, 24, 5, 32, "#e8b770");
    rect(ctx, x + 8, 33, 21, 5, "#e8b770");
  }
  return canvas;
}

export function knightSprites() {
  const sprites = new Map();
  for (const kind of ["viewer", "champion", "reinforcement"]) {
    for (const defended of [false, true]) {
      const { canvas, ctx } = surface(24, 29);
      const gold = kind === "champion";
      const metal = gold ? "#ffda83" : "#d4e0ec";
      const coat = gold
        ? "#d99640"
        : kind === "reinforcement"
          ? "#9e8bd3"
          : "#74c9ac";
      if (gold) {
        rect(ctx, 2, 1, 1, 25, "#ffedb0");
        polygon(
          ctx,
          [
            [3, 1],
            [12, 1],
            [12, 10],
            [8, 8],
            [3, 10],
          ],
          "#d89232",
        );
        rect(ctx, 6, 3, 2, 4, "#fff1b7");
      }
      rect(ctx, 8, 8, 10, 7, "#171f32");
      rect(ctx, 7, 8, 9, 6, metal);
      rect(ctx, 8, 7, 6, 2, metal);
      rect(ctx, 10, 10, 7, 2, "#344458");
      rect(ctx, 14, 10, 2, 1, "#fff6d8");
      rect(ctx, 8, 14, 9, 9, coat);
      rect(ctx, 7, 15, 3, 5, metal);
      rect(ctx, 10, 16, 3, 5, "#e7e8d0");
      rect(ctx, 8, 21, 9, 2, "#443b43");
      rect(ctx, 8, 23, 3, 4, metal);
      rect(ctx, 14, 23, 3, 4, metal);
      rect(ctx, 7, 26, 5, 2, "#303746");
      rect(ctx, 14, 26, 5, 2, "#303746");
      rect(ctx, 20, 10, 2, 12, "#eef6f0");
      rect(ctx, 18, 21, 6, 2, "#f2c274");
      if (gold) {
        rect(ctx, 7, 6, 9, 2, "#ffdb78");
        for (let x = 7; x < 17; x += 4) rect(ctx, x, 4, 2, 3, "#ffdb78");
      }
      if (defended) {
        polygon(
          ctx,
          [
            [4, 16],
            [11, 15],
            [12, 23],
            [8, 26],
            [4, 23],
          ],
          "#76c9f3",
        );
        rect(ctx, 7, 17, 2, 7, "#e0f7ff");
        rect(ctx, 5, 19, 6, 2, "#e0f7ff");
      }
      sprites.set(`${kind}:${defended}`, canvas);
    }
  }
  return sprites;
}

/** Draw on a low-resolution surface, then scale with nearest-neighbour pixels. */
export function dragonSprite(color, rage = false) {
  const { canvas, ctx } = surface(144, 126);
  const edge = "#141626",
    body = "#383348",
    scale = color;
  polygon(
    ctx,
    [
      [72, 64],
      [63, 26],
      [75, 4],
      [91, 18],
      [107, 6],
      [120, 25],
      [140, 10],
      [133, 66],
      [119, 57],
      [104, 72],
      [87, 60],
    ],
    edge,
  );
  polygon(
    ctx,
    [
      [78, 58],
      [72, 29],
      [76, 13],
      [89, 24],
      [105, 15],
      [117, 34],
      [132, 22],
      [128, 55],
      [117, 47],
      [104, 62],
    ],
    "#66394e",
  );
  polygon(
    ctx,
    [
      [77, 24],
      [88, 52],
      [105, 16],
      [98, 58],
      [129, 25],
      [111, 64],
      [80, 65],
    ],
    "#a35862",
  );
  polygon(
    ctx,
    [
      [76, 79],
      [110, 87],
      [128, 79],
      [135, 62],
      [143, 56],
      [141, 91],
      [124, 104],
      [84, 101],
    ],
    edge,
  );
  polygon(
    ctx,
    [
      [82, 84],
      [113, 93],
      [130, 84],
      [137, 69],
      [136, 88],
      [121, 99],
      [84, 96],
    ],
    body,
  );
  polygon(
    ctx,
    [
      [57, 47],
      [81, 49],
      [98, 72],
      [100, 101],
      [90, 113],
      [58, 112],
      [41, 98],
      [45, 74],
    ],
    edge,
  );
  polygon(
    ctx,
    [
      [56, 52],
      [77, 54],
      [90, 73],
      [93, 97],
      [83, 108],
      [59, 107],
      [47, 95],
      [49, 73],
    ],
    body,
  );
  polygon(
    ctx,
    [
      [51, 69],
      [63, 70],
      [74, 91],
      [71, 107],
      [57, 101],
      [46, 89],
    ],
    "#b77570",
  );
  for (let y = 76; y < 104; y += 7)
    rect(ctx, 51, y, 18 + (y % 3) * 2, 2, "#744f61");
  polygon(
    ctx,
    [
      [60, 64],
      [44, 61],
      [31, 47],
      [28, 26],
      [42, 13],
      [58, 17],
      [68, 33],
      [66, 51],
    ],
    edge,
  );
  polygon(
    ctx,
    [
      [56, 60],
      [45, 56],
      [36, 44],
      [34, 28],
      [43, 19],
      [56, 23],
      [62, 34],
      [60, 50],
    ],
    body,
  );
  polygon(
    ctx,
    [
      [40, 27],
      [24, 34],
      [9, 36],
      [4, 48],
      [11, 56],
      [38, 54],
      [52, 44],
    ],
    edge,
  );
  polygon(
    ctx,
    [
      [38, 31],
      [25, 39],
      [12, 40],
      [10, 47],
      [15, 51],
      [36, 49],
      [45, 41],
    ],
    body,
  );
  rect(ctx, 14, 45, 22, 3, "#111322");
  rect(ctx, 19, 46, 3, 5, "#f8d7b0");
  rect(ctx, 29, 46, 3, 4, "#f8d7b0");
  polygon(
    ctx,
    [
      [35, 26],
      [30, 11],
      [44, 18],
    ],
    "#efd9ba",
  );
  polygon(
    ctx,
    [
      [49, 20],
      [55, 3],
      [60, 27],
    ],
    "#efd9ba",
  );
  rect(ctx, 35, 33, 10, 5, rage ? "#ff504d" : "#ffcc70");
  rect(ctx, 37, 32, 2, 8, "#fff3c1");
  for (let i = 0; i < 6; i++) rect(ctx, 63 + i * 5, 53 + i * 7, 5, 4, scale);
  polygon(
    ctx,
    [
      [49, 75],
      [32, 80],
      [24, 95],
      [35, 98],
      [42, 86],
      [54, 84],
    ],
    edge,
  );
  rect(ctx, 24, 94, 13, 4, "#e0c0a0");
  polygon(
    ctx,
    [
      [60, 100],
      [55, 114],
      [39, 116],
      [37, 123],
      [67, 123],
      [72, 106],
    ],
    edge,
  );
  polygon(
    ctx,
    [
      [84, 99],
      [88, 114],
      [76, 119],
      [77, 124],
      [103, 124],
      [99, 106],
    ],
    edge,
  );
  for (const x of [40, 48, 56, 78, 86, 94]) rect(ctx, x, 119, 5, 4, "#e8d2b3");
  return canvas;
}
