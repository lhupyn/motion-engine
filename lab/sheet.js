// Contact sheets: a grid of captured cells with captions, saved through the dev server and previewed on the page.

const PAD = 8;
const CAPTION = 30;
const FONT = '-apple-system, Helvetica, sans-serif';

/**
 * A white canvas with a title and an empty grid.
 * @param {object} options
 * @param {string} options.title
 * @param {string} [options.subtitle]
 * @param {number} options.columns
 * @param {number} options.rows
 * @param {number} [options.cell=440] - Cell width and height, px
 * @returns {{canvas: HTMLCanvasElement, put: (row: number, col: number, cell: CanvasImageSource, label: string) => void}}
 */
export function createSheet({ title, subtitle = '', columns, rows, cell = 440 }) {
  const top = subtitle ? 72 : 46;
  const canvas = document.createElement('canvas');
  canvas.width = PAD + columns * (cell + PAD);
  canvas.height = top + rows * (cell + CAPTION + PAD);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111';
  context.font = `bold 26px ${FONT}`;
  context.fillText(title, PAD + 4, 32, canvas.width - 2 * PAD);
  context.font = `17px ${FONT}`;
  context.fillText(subtitle, PAD + 4, 58, canvas.width - 2 * PAD);

  function put(row, col, image, label) {
    const x = PAD + col * (cell + PAD);
    const y = top + row * (cell + CAPTION + PAD);
    context.drawImage(image, x, y, cell, cell);
    context.fillStyle = '#111';
    context.font = `19px ${FONT}`;
    context.fillText(label, x + 6, y + cell + CAPTION - 9, cell - 10);
  }
  return { canvas, put };
}

async function post(file, body) {
  const response = await fetch(`/__save?path=${encodeURIComponent(file)}`, { method: 'POST', body });
  if (!response.ok) throw new Error(`could not save ${file}: ${response.status} ${await response.text()}`);
}

/**
 * Saves a sheet as `lab/out/<file>` (JPEG) and shows it on the page.
 * @param {HTMLCanvasElement} canvas
 * @param {string} file - Relative to lab/out/
 * @returns {Promise<string>} file
 */
export async function publish(canvas, file) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error(`could not encode ${file}`);
  await post(file, blob);

  const figure = document.createElement('figure');
  const image = Object.assign(document.createElement('img'), { src: URL.createObjectURL(blob), alt: file });
  const caption = Object.assign(document.createElement('figcaption'), { textContent: `lab/out/${file}` });
  figure.append(image, caption);
  document.getElementById('out').append(figure);
  return file;
}

/**
 * Saves data as `lab/out/<file>`.
 * @param {unknown} data
 * @param {string} file - Relative to lab/out/, ending in .json
 * @returns {Promise<string>} file
 */
export async function saveJson(data, file) {
  await post(file, JSON.stringify(data, null, 2));
  return file;
}
