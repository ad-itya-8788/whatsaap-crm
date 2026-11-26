// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { changeAppearance, useAccentTheme, useColorMode } from './appearance.js'

afterEach(() => {
  cleanup()
  localStorage.clear()
  delete document.documentElement.dataset.mode
  delete document.documentElement.dataset.theme
})

it('keeps independently mounted appearance controls in sync and saves each choice', () => {
  function HeaderSwitch() {
    const mode = useColorMode()
    return <button onClick={() => changeAppearance({ mode: 'light' })}>{mode}</button>
  }

  function SettingsSwitch() {
    const mode = useColorMode()
    const theme = useAccentTheme()
    return <button onClick={() => changeAppearance({ mode: 'dark', theme: 'violet' })}>{mode} / {theme}</button>
  }

  render(<><HeaderSwitch /><SettingsSwitch /></>)
  fireEvent.click(screen.getByRole('button', { name: 'dark', exact: true }))
  expect(screen.getByRole('button', { name: 'light / emerald' })).toBeTruthy()
  expect(localStorage.getItem('wacrm.mode')).toBe('light')

  fireEvent.click(screen.getByRole('button', { name: 'light / emerald' }))
  expect(screen.getByRole('button', { name: 'dark', exact: true })).toBeTruthy()
  expect(document.documentElement.dataset.theme).toBe('violet')
  expect(localStorage.getItem('wacrm.theme')).toBe('violet')
})
