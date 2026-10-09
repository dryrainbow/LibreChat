import {
  EModelEndpoint,
  ReasoningEffort,
  paramSettings,
  getSettingsKeys,
  getEndpointField,
  normalizeEndpointName,
  supportsAdaptiveThinking,
  applyModelAwareDefaults,
  resolveDropParamsUIKeys,
} from 'librechat-data-provider';
import type {
  SettingDefinition,
  TConversation,
  TEndpointsConfig,
  TStartupConfig,
} from 'librechat-data-provider';
import type { Endpoint } from '~/common';

export type ThinkingControl =
  | {
      kind: 'mode';
      defaultValue: string;
      options: string[];
      labels: SettingDefinition['enumMappings'];
    }
  | {
      kind: 'effort';
      settingKey: 'reasoning_effort' | 'effort' | 'thinkingLevel';
      defaultValue: string;
      options: string[];
      labels: SettingDefinition['enumMappings'];
    };

type ThinkingConversation = Partial<Omit<TConversation, 'endpoint'>> & { endpoint?: string | null };

const hermesEndpoints = ['Hermes', 'Hermes Adaptive'];
const flashEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Use the same model-aware definitions and administrator drops as the parameters panel. */
export function resolveThinkingControl({
  conversation,
  endpointsConfig,
  mappedEndpoints,
  startupConfig,
}: {
  conversation: ThinkingConversation | null;
  endpointsConfig: TEndpointsConfig;
  mappedEndpoints: Endpoint[];
  startupConfig?: Pick<TStartupConfig, 'endpointsDropParamsMap'>;
}): ThinkingControl | null {
  const endpoint = conversation?.endpoint ?? '';
  const model = conversation?.model ?? '';
  if (!endpoint || !model) {
    return null;
  }

  if (hermesEndpoints.includes(endpoint) && model === 'MiniMax-M3') {
    const modesAvailable = hermesEndpoints.every((name) =>
      mappedEndpoints.some(
        (entry) =>
          entry.value === name && entry.models?.some((entryModel) => entryModel.name === model),
      ),
    );
    return modesAvailable
      ? {
          kind: 'mode',
          defaultValue: endpoint,
          options: hermesEndpoints,
          labels: {
            Hermes: 'com_ui_thinking_always',
            'Hermes Adaptive': 'com_ui_thinking_adaptive',
          },
        }
      : null;
  }

  const config = endpointsConfig ?? {};
  const type = getEndpointField(config, endpoint, 'type') ?? endpoint;
  const customParams = config[endpoint]?.customParams;
  const [combinedKey, endpointKey] = getSettingsKeys(type, model);
  const defaultParamsEndpoint = customParams?.defaultParamsEndpoint ?? endpointKey;
  const dropMap = startupConfig?.endpointsDropParamsMap;
  const dropEntry = dropMap?.[endpoint] ?? dropMap?.[normalizeEndpointName(endpoint)];
  const drops = Array.isArray(dropEntry) ? dropEntry : dropEntry?.[model];
  const droppedKeys = resolveDropParamsUIKeys(drops, defaultParamsEndpoint);
  const defaults = paramSettings[combinedKey] ?? paramSettings[defaultParamsEndpoint] ?? [];
  const definitions = applyModelAwareDefaults(
    defaults,
    defaultParamsEndpoint,
    model,
    config[endpoint]?.responsesApiRouting,
  );
  let key: 'reasoning_effort' | 'effort' | 'thinkingLevel' = 'reasoning_effort';
  if (supportsAdaptiveThinking(model)) {
    key = 'effort';
  } else if (/(?:^|\/)gemini-[3-9](?:[.-]|$)/i.test(model)) {
    key = 'thinkingLevel';
  }
  if (droppedKeys.has(key)) {
    return null;
  }
  const definition = definitions.find((setting) => setting.key === key);
  const override = customParams?.paramDefinitions?.find((setting) => setting.key === key);
  const setting = (override as SettingDefinition | undefined) ?? definition;
  if (!setting?.options?.length) {
    return null;
  }

  if (hermesEndpoints.includes(endpoint) && model === 'MiniMax-M3.1-Flash-Preview') {
    const options = override
      ? flashEfforts.filter((effort) => setting.options?.includes(effort))
      : flashEfforts;
    if (!options.length) {
      return null;
    }
    return {
      kind: 'effort',
      settingKey: 'reasoning_effort',
      defaultValue:
        typeof override?.default === 'string' ? override.default : ReasoningEffort.medium,
      options,
      labels: setting.enumMappings,
    };
  }

  const modelName = model.split('/').pop() ?? model;
  const nativeReasoningModel =
    /^(?:o[134](?:[-.]|$)|gpt-[56](?:[-.]|$)|grok-4[.-]7(?:[-:]|$))/i.test(modelName) &&
    !/-chat(?:-|$)/i.test(modelName);
  const modelSpecificSetting = paramSettings[combinedKey]?.some(
    (entry) => entry.key === 'reasoning_effort',
  );
  if (key === 'reasoning_effort' && !override && !modelSpecificSetting && !nativeReasoningModel) {
    return null;
  }
  if (type === EModelEndpoint.agents || type === EModelEndpoint.assistants) {
    return null;
  }

  return {
    kind: 'effort',
    settingKey: key,
    defaultValue: typeof setting.default === 'string' ? setting.default : ReasoningEffort.unset,
    options: override ? setting.options : filterNativeOptions(key, modelName, setting.options),
    labels: setting.enumMappings,
  };
}

/** Older native models reject some levels present in the provider-wide definition. */
function filterNativeOptions(key: string, model: string, options: string[]): string[] {
  if (
    key === 'effort' &&
    /claude-(?:(?:opus|sonnet)[-.]4[-.]6|4[-.]6-(?:opus|sonnet))/.test(model)
  ) {
    return options.filter((option) => option !== 'xhigh');
  }
  if (key !== 'thinkingLevel') {
    return options;
  }
  if (/gemini-3(?:[.-]\d+)?-pro/.test(model)) {
    return options.filter(
      (option) => option !== 'minimal' && (option !== 'medium' || !/^gemini-3-pro/.test(model)),
    );
  }
  if (/gemini-3[.-](?:7|8)-flash/.test(model)) {
    return options.filter((option) => option !== 'minimal');
  }
  if (/gemini-3\.1-flash-lite-image/.test(model)) {
    return options.filter((option) => option === '' || option === 'minimal' || option === 'high');
  }
  return options;
}

export function getThinkingValue(
  control: ThinkingControl,
  conversation: ThinkingConversation | null,
): string {
  if (control.kind === 'mode') {
    return conversation?.endpoint ?? control.defaultValue;
  }
  const value = conversation?.[control.settingKey] ?? control.defaultValue;
  return value === '' && !control.options.includes('') ? control.defaultValue : value;
}
