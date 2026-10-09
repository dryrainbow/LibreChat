import { EModelEndpoint, ReasoningEffort, AnthropicEffort } from 'librechat-data-provider';
import type { TConversation, TEndpointsConfig } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { resolveThinkingControl, getThinkingValue } from '../thinking';

const mappedEndpoints: Endpoint[] = ['Hermes', 'Hermes Adaptive'].map((value) => ({
  value,
  label: value,
  hasModels: true,
  models: [{ name: 'MiniMax-M3' }, { name: 'MiniMax-M3.1-Flash-Preview' }],
  icon: null,
}));
const endpointsConfig: TEndpointsConfig = {
  Hermes: { type: EModelEndpoint.custom, order: 0 },
  'Hermes Adaptive': { type: EModelEndpoint.custom, order: 1 },
};
const resolve = (
  conversation: Partial<Omit<TConversation, 'endpoint'>> & { endpoint?: string | null },
  config = endpointsConfig,
) => resolveThinkingControl({ conversation, endpointsConfig: config, mappedEndpoints });

describe('thinking capabilities', () => {
  it('uses endpoint modes for M3 and reads the saved mode', () => {
    const conversation = { endpoint: 'Hermes Adaptive', model: 'MiniMax-M3' };
    const control = resolve(conversation);
    expect(control).toMatchObject({ kind: 'mode', options: ['Hermes', 'Hermes Adaptive'] });
    expect(getThinkingValue(control!, conversation)).toBe('Hermes Adaptive');
  });

  it('requires both M3 endpoints to advertise the selected model', () => {
    expect(
      resolveThinkingControl({
        conversation: { endpoint: 'Hermes', model: 'MiniMax-M3' },
        endpointsConfig,
        mappedEndpoints: mappedEndpoints.slice(0, 1),
      }),
    ).toBeNull();
  });

  it('offers only Flash-supported levels and defaults to medium without writing state', () => {
    const conversation = { endpoint: 'Hermes', model: 'MiniMax-M3.1-Flash-Preview' };
    const control = resolve(conversation);
    expect(control).toMatchObject({
      kind: 'effort',
      settingKey: 'reasoning_effort',
      options: ['low', 'medium', 'high', 'xhigh', 'max'],
    });
    expect(getThinkingValue(control!, conversation)).toBe('medium');
    expect(conversation).not.toHaveProperty('reasoning_effort');
    expect(
      getThinkingValue(control!, { ...conversation, reasoning_effort: ReasoningEffort.unset }),
    ).toBe('medium');
  });

  it('retains a saved effort, including a now-unavailable value', () => {
    const conversation = {
      endpoint: 'Hermes',
      model: 'MiniMax-M3.1-Flash-Preview',
      reasoning_effort: ReasoningEffort.minimal,
    };
    expect(getThinkingValue(resolve(conversation)!, conversation)).toBe('minimal');
  });

  it('uses native model-aware GPT options', () => {
    const control = resolve({ endpoint: EModelEndpoint.openAI, model: 'gpt-6.1-sol' });
    expect(control?.options).toContain('high');
    expect(control?.options).not.toContain('minimal');
  });

  it.each(['gpt-4o', 'gpt-5-chat-latest', 'unrecognized-model'])(
    'hides unsupported %s',
    (model) => {
      expect(resolve({ endpoint: EModelEndpoint.openAI, model })).toBeNull();
    },
  );

  it('uses the native Anthropic effort field and saved value', () => {
    const conversation = {
      endpoint: EModelEndpoint.anthropic,
      model: 'claude-opus-4-6',
      effort: AnthropicEffort.high,
    };
    const control = resolve(conversation);
    expect(control).toMatchObject({ kind: 'effort', settingKey: 'effort' });
    expect(getThinkingValue(control!, conversation)).toBe('high');
    expect(resolve({ endpoint: EModelEndpoint.anthropic, model: 'claude-3-haiku' })).toBeNull();
  });

  it('uses Gemini 3 native thinkingLevel and hides earlier non-level models', () => {
    expect(resolve({ endpoint: EModelEndpoint.google, model: 'gemini-3.1-pro' })).toMatchObject({
      kind: 'effort',
      settingKey: 'thinkingLevel',
    });
    expect(resolve({ endpoint: EModelEndpoint.google, model: 'gemini-2.5-flash' })).toBeNull();
  });

  it('honors explicit custom model capability and its configured options', () => {
    const control = resolve(
      { endpoint: 'Custom', model: 'new-reasoner' },
      {
        Custom: {
          type: EModelEndpoint.custom,
          order: 2,
          customParams: {
            paramDefinitions: [
              {
                key: 'reasoning_effort',
                type: 'enum',
                component: 'dropdown',
                default: 'low',
                options: ['low', 'high'],
              },
            ],
          },
        },
      },
    );
    expect(control).toMatchObject({ options: ['low', 'high'], defaultValue: 'low' });
  });

  it('respects administrator drops even for Flash', () => {
    expect(
      resolveThinkingControl({
        conversation: { endpoint: 'Hermes', model: 'MiniMax-M3.1-Flash-Preview' },
        endpointsConfig,
        mappedEndpoints,
        startupConfig: { endpointsDropParamsMap: { Hermes: ['reasoning_effort'] } },
      }),
    ).toBeNull();
  });

  it('intersects Flash options with an explicit administrator definition', () => {
    expect(
      resolve(
        { endpoint: 'Hermes', model: 'MiniMax-M3.1-Flash-Preview' },
        {
          Hermes: {
            type: EModelEndpoint.custom,
            order: 0,
            customParams: {
              paramDefinitions: [
                {
                  key: 'reasoning_effort',
                  type: 'enum',
                  component: 'dropdown',
                  default: 'low',
                  options: ['none', 'low', 'high'],
                },
              ],
            },
          },
        },
      ),
    ).toMatchObject({ options: ['low', 'high'], defaultValue: 'low' });
  });

  it('removes levels rejected by older native models', () => {
    expect(
      resolve({ endpoint: EModelEndpoint.anthropic, model: 'claude-opus-4-6' })?.options,
    ).not.toContain('xhigh');
    expect(
      resolve({ endpoint: EModelEndpoint.google, model: 'gemini-3-pro-preview' })?.options,
    ).toEqual(['', 'low', 'high']);
    expect(
      resolve({ endpoint: EModelEndpoint.google, model: 'gemini-3.1-pro-preview' })?.options,
    ).toEqual(['', 'low', 'medium', 'high']);
    expect(
      resolve({ endpoint: EModelEndpoint.google, model: 'gemini-3.8-flash' })?.options,
    ).not.toContain('minimal');
    expect(
      resolve({ endpoint: EModelEndpoint.google, model: 'gemini-3.7-flash' })?.options,
    ).not.toContain('minimal');
  });

  it('returns nothing until endpoint data and model are available', () => {
    expect(
      resolveThinkingControl({
        conversation: null,
        endpointsConfig: undefined,
        mappedEndpoints: [],
      }),
    ).toBeNull();
  });
});
