import * as React from 'react'

import { Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import {
  CHANGELOG_URL,
  fetchAndStoreChangelog,
  getAllReleaseNotes,
  getStoredChangelog,
} from '../../utils/releaseNotes.js'
import { gt } from '../../utils/semver.js'

const SHOW_ALL_VALUE = '__show_all__'

function formatVersionNotes(version: string, notes: string[]): string {
  const header = `Version ${version}:`
  const bulletPoints = notes.map((note) => `· ${note}`).join('\n')
  return `${header}\n${bulletPoints}`
}

function formatAllNotes(notes: Array<[string, string[]]>): string {
  return notes
    .toSorted(([versionA], [versionB]) => (gt(versionA, versionB) ? 1 : -1)) // oldest first
    .map(([version, versionNotes]) => formatVersionNotes(version, versionNotes))
    .join('\n\n')
}

type ReleaseNotesPickerProps = {
  /** Versions sorted newest first. */
  notes: Array<[string, string[]]>
  onDone: LocalJSXCommandOnDone
}

function ReleaseNotesPicker({ notes, onDone }: ReleaseNotesPickerProps): React.ReactNode {
  const options = [
    {
      label: 'Show all',
      description: `${notes.length} versions`,
      value: SHOW_ALL_VALUE,
    },
    ...notes.map(([version, versionNotes]) => ({
      label: `Version ${version}`,
      description: `${versionNotes.length} ${versionNotes.length === 1 ? 'item' : 'items'}`,
      value: version,
    })),
  ]

  const handleCancel = () => onDone(undefined, { display: 'skip' })

  const handleChange = (value: string) => {
    if (value === SHOW_ALL_VALUE) {
      onDone(formatAllNotes(notes), { display: 'system' })
      return
    }
    const entry = notes.find(([version]) => version === value)
    if (!entry) {
      onDone(undefined, { display: 'skip' })
      return
    }
    onDone(formatVersionNotes(entry[0], entry[1]), { display: 'system' })
  }

  return (
    <Dialog title="Release notes" onCancel={handleCancel}>
      <Box flexDirection="column" marginBottom={1}>
        <Text dimColor>Select a version to view its notes.</Text>
      </Box>
      <Select options={options} visibleOptionCount={10} onChange={handleChange} onCancel={handleCancel} />
    </Dialog>
  )
}

export async function call(onDone: LocalJSXCommandOnDone): Promise<React.ReactNode> {
  // Try to fetch the latest changelog with a 500ms timeout
  try {
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout((rej) => rej(new Error('Timeout')), 500, reject)
    })
    await Promise.race([fetchAndStoreChangelog(), timeoutPromise])
  } catch {
    // Either fetch failed or timed out - just use cached notes
  }

  const notes = getAllReleaseNotes(await getStoredChangelog())
  if (notes.length === 0) {
    onDone(`See the full changelog at: ${CHANGELOG_URL}`, { display: 'system' })
    return null
  }

  // Newest first in the picker.
  const newestFirst = notes.toSorted(([versionA], [versionB]) => (gt(versionA, versionB) ? -1 : 1))
  return <ReleaseNotesPicker notes={newestFirst} onDone={onDone} />
}
