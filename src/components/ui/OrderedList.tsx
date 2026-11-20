import React, { createContext, isValidElement, type ReactNode, useContext, useMemo } from 'react'

import { Box } from '../../ink.js'
import { OrderedListItem, OrderedListItemContext } from './OrderedListItem.js'

const OrderedListContext = createContext({ marker: '' })

type OrderedListProps = {
  children: ReactNode
}

function OrderedListItemWrapper({ marker, children }: { marker: string; children: ReactNode }): React.ReactNode {
  const markerValue = useMemo(() => ({ marker }), [marker])
  return (
    <OrderedListContext.Provider value={markerValue}>
      <OrderedListItemContext.Provider value={markerValue}>{children}</OrderedListItemContext.Provider>
    </OrderedListContext.Provider>
  )
}

function OrderedListComponent({ children }: OrderedListProps): React.ReactNode {
  const { marker: parentMarker } = useContext(OrderedListContext)

  let numberOfItems = 0
  for (const child of React.Children.toArray(children)) {
    if (!isValidElement(child) || child.type !== OrderedListItem) {
      continue
    }
    numberOfItems++
  }

  const maxMarkerWidth = String(numberOfItems).length

  return (
    <Box flexDirection="column">
      {React.Children.map(children, (child, index) => {
        if (!isValidElement(child) || child.type !== OrderedListItem) {
          return child
        }

        const paddedMarker = `${String(index + 1).padStart(maxMarkerWidth)}.`
        const marker = `${parentMarker}${paddedMarker}`

        return (
          <OrderedListItemWrapper key={index} marker={marker}>
            {child}
          </OrderedListItemWrapper>
        )
      })}
    </Box>
  )
}

// eslint-disable-next-line custom-rules/no-top-level-side-effects
OrderedListComponent.Item = OrderedListItem

export const OrderedList = OrderedListComponent
