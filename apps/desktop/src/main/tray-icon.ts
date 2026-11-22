/**
 * The tray icon, as a data URL.
 *
 * The app ships no icon bundle (electron-builder draws the installer art from the
 * default), so the tray carries its own 32 px PNG: WeChat green, rounded square,
 * white double speech bubble. A 32 px image is enough for the notification area,
 * and keeping it inline means the tray works from the packaged asar without an
 * extra resources entry.
 */
export const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA10lEQVR4nNWXSw7CMAxE01Ekeiq4CpwMrgKnalegLiKlKMZO6o+YXT6e56RulKQUrIkaOD2vb03Qenk0WZM1mEsEnvAWA57wFgspWPBefVFhIgUrSycu53u3+fy6sXNgBZfGwQoujYclXOIDazjnl48UVm1K9XPCKLxuU/3qCVgIf5XA8vVtS5vqlyj3JPDLfPSvATXQU0gSUX4YCdKCswloJMHFQ8PkSFwecu6EmJ0Ds0KN5CjwbgdW4tFgCS9M9ARpnw2bdiv3uh3XOw5qwAO+KfxxGq4PMk1bEsrVOt8AAAAASUVORK5CYII='
