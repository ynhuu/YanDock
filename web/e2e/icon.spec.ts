import { expect, test } from '@playwright/test'

test('Safari 主屏幕图标资源可用且为 180×180', async ({ page }) => {
  await page.goto('/')
  const appleIcon = page.locator('link[rel="apple-touch-icon"]')
  await expect(appleIcon).toHaveAttribute('sizes', '180x180')
  await expect(appleIcon).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(
    page.locator('meta[name="apple-mobile-web-app-title"]'),
  ).toHaveAttribute('content', 'YanDock')

  const dimensions = await page.evaluate(async () => {
    const response = await fetch('/apple-touch-icon.png')
    const image = await createImageBitmap(await response.blob())
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(image, 0, 0)
    const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3]
    const outerBackground = Array.from(context.getImageData(0, 0, 1, 1).data)
    const screenFill = Array.from(context.getImageData(90, 50, 1, 1).data)
    const terminalMark = Array.from(context.getImageData(72, 78, 1, 1).data)
    return {
      status: response.status,
      width: image.width,
      height: image.height,
      cornerAlpha,
      outerBackground,
      screenFill,
      terminalMark,
    }
  })
  expect(dimensions).toEqual({
    status: 200,
    width: 180,
    height: 180,
    cornerAlpha: 255,
    outerBackground: [36, 39, 45, 255],
    screenFill: [18, 25, 35, 255],
    terminalMark: [100, 228, 163, 255],
  })
})

test('网站提供兼容用 ICO favicon', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.locator('link[rel="icon"][type="image/svg+xml"]'),
  ).toHaveCount(0)
  await expect(page.locator('link[rel="icon"][type="image/png"]')).toHaveCount(
    0,
  )
  const favicon = page.locator('link[rel="icon"][type="image/x-icon"]')
  await expect(favicon).toHaveAttribute('href', '/favicon.ico?v=7')

  const icon = await page.evaluate(async () => {
    const response = await fetch('/favicon.ico?v=7')
    const blob = await response.blob()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const image = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D context is unavailable')
    context.drawImage(image, 0, 0)
    return {
      status: response.status,
      signature: Array.from(bytes.slice(0, 4)),
      size: bytes.byteLength,
      outerCorner: Array.from(context.getImageData(0, 0, 1, 1).data),
      roundedBackground: Array.from(
        context.getImageData(
          Math.floor(image.width / 2),
          Math.floor(image.height * 0.1),
          1,
          1,
        ).data,
      ),
    }
  })
  expect(icon.status).toBe(200)
  expect(icon.signature).toEqual([0, 0, 1, 0])
  expect(icon.size).toBeGreaterThan(1024)
  expect(icon.outerCorner[3]).toBeLessThan(16)
  expect(icon.roundedBackground[0]).toBeGreaterThanOrEqual(30)
  expect(icon.roundedBackground[0]).toBeLessThanOrEqual(42)
  expect(icon.roundedBackground[1]).toBeGreaterThanOrEqual(33)
  expect(icon.roundedBackground[1]).toBeLessThanOrEqual(45)
  expect(icon.roundedBackground[2]).toBeGreaterThanOrEqual(39)
  expect(icon.roundedBackground[2]).toBeLessThanOrEqual(51)
  expect(icon.roundedBackground[3]).toBeGreaterThan(240)
})
