import { useMemo } from 'react';
import { Select, SelectItem, SelectValue, SelectContent, SelectTrigger } from '@librechat/client';
import type { TStartupConfig } from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { resolveThinkingControl, getThinkingValue } from './thinking';
import { useModelSelectorContext } from './ModelSelectorContext';
import { useLocalize, useSetIndexOptions } from '~/hooks';
import { useChatContext } from '~/Providers';

const automaticValue = '__automatic__';

export default function Thinking({ startupConfig }: { startupConfig?: TStartupConfig }) {
  const localize = useLocalize();
  const { conversation, isSubmitting } = useChatContext();
  const { setOption } = useSetIndexOptions();
  const { endpointsConfig, mappedEndpoints } = useModelSelectorContext();
  const control = useMemo(
    () => resolveThinkingControl({ conversation, endpointsConfig, mappedEndpoints, startupConfig }),
    [conversation, endpointsConfig, mappedEndpoints, startupConfig],
  );
  if (!control) {
    return null;
  }

  const value = getThinkingValue(control, conversation);
  const isUnavailable = !control.options.includes(value);
  const displayLabel = (option: string) => {
    const key = control.labels?.[option];
    if (typeof key === 'string') {
      return key.startsWith('com_') ? localize(key as TranslationKeys) : key;
    }
    return option || localize('com_ui_auto');
  };
  const label = localize('com_endpoint_thinking');

  return (
    <Select
      value={value || automaticValue}
      disabled={isSubmitting}
      onValueChange={(nextValue) => {
        const selected = nextValue === automaticValue ? '' : nextValue;
        if (!control.options.includes(selected)) {
          return;
        }
        // These Hermes endpoints are modes of the same agent and model. A parameter
        // update retains the current chat, unlike selecting a different endpoint.
        setOption(control.kind === 'mode' ? 'endpoint' : control.settingKey)(selected);
      }}
    >
      <SelectTrigger
        data-testid="thinking-selector"
        aria-label={`${label}: ${displayLabel(value)}`}
        className="my-1 w-auto min-w-0 shrink-0 gap-1 rounded-xl border-border-light bg-presentation px-2 text-xs text-text-primary"
      >
        <span className="min-w-0">
          <span className="mr-1 hidden sm:inline">{label}:</span>
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {isUnavailable && (
          <SelectItem value={value || automaticValue} disabled>
            {displayLabel(value)} — {localize('com_ui_thinking_saved_unavailable')}
          </SelectItem>
        )}
        {control.options.map((option) => (
          <SelectItem key={option || automaticValue} value={option || automaticValue}>
            {displayLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
