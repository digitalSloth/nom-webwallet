<script setup lang="ts">
import { Address, Alert, Amount, Button, Skeleton, TxDirection, TxStatus } from 'nom-ui'
import { activityLabel } from '@/core'
import type { ActivityRow } from '@/core'
import { formatAmount } from '@/shared/lib/amount'
import {
  blockStatusLabel,
  blockStatusTone,
  explorerAccountUrl,
  explorerBlockUrl,
  relativeTime,
} from '@/shared/lib/format'

defineProps<{
  rows: ActivityRow[]
  showHash?: boolean
  isLoading: boolean
  error: string | null
}>()

defineEmits<{ retry: [] }>()
</script>

<template>
  <div v-if="rows.length === 0" class="px-5 py-6">
    <div v-if="isLoading" class="space-y-3">
      <Skeleton v-for="n in 4" :key="n" class="h-10 w-full" />
    </div>
    <div v-else-if="error" class="flex flex-col items-center gap-3 text-center">
      <p class="text-sm text-muted-foreground">{{ error }}</p>
      <Button variant="outline" size="sm" @click="$emit('retry')">Try again</Button>
    </div>
    <p v-else class="text-center text-sm text-muted-foreground">No activity yet</p>
  </div>

  <div v-else>
    <div class="relative overflow-x-auto">
      <table
        :class="['w-full border-collapse text-sm', showHash ? 'min-w-[860px]' : 'min-w-[720px]']"
      >
        <thead>
          <tr class="text-ledger text-muted-foreground">
            <th class="px-5 py-2.5 text-left font-medium">Type</th>
            <th class="px-3 py-2.5 text-right font-medium">Amount</th>
            <th class="px-3 py-2.5 text-left font-medium">From / to</th>
            <th v-if="showHash" class="px-3 py-2.5 text-left font-medium">Hash</th>
            <th class="px-3 py-2.5 text-right font-medium">Height</th>
            <th class="px-3 py-2.5 text-left font-medium">Time</th>
            <th class="px-5 py-2.5 text-right font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.hash" class="border-t">
            <td class="px-5 py-3">
              <TxDirection
                :direction="row.direction === 'in' ? 'in' : 'out'"
                :label="activityLabel(row)"
              />
            </td>
            <td class="px-3 py-3 text-right">
              <Amount
                :value="formatAmount(BigInt(row.amount), row.decimals)"
                :decimals="row.decimals"
                :symbol="row.symbol"
                dim-trailing-zeros
              />
            </td>
            <td class="px-3 py-3">
              <Address
                v-if="row.counterparty"
                :address="row.counterparty"
                :start="8"
                :end="6"
                :copy="false"
                :href="explorerAccountUrl(row.counterparty)"
              />
              <span v-else class="text-muted-foreground">—</span>
            </td>
            <td v-if="showHash" class="px-3 py-3 text-[13px]">
              <Address
                :address="row.hash"
                :start="6"
                :end="4"
                copy
                :href="explorerBlockUrl(row.hash)"
              />
            </td>
            <td class="px-3 py-3 text-right font-mono text-[13px] tabular-nums">
              {{ row.height.toLocaleString('en-US') }}
            </td>
            <td class="px-3 py-3 text-[13px] text-muted-foreground">
              {{ row.timestamp === null ? 'Pending' : relativeTime(row.timestamp) }}
            </td>
            <td class="px-5 py-3 text-right">
              <TxStatus
                :status="blockStatusTone(row.status)"
                :label="blockStatusLabel(row.status)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <Alert v-if="error" variant="destructive" class="m-4 flex items-center gap-3 text-sm">
      <span>{{ error }}</span>
      <Button variant="outline" size="sm" @click="$emit('retry')">Try again</Button>
    </Alert>
  </div>
</template>
