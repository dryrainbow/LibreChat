import React, { useState } from 'react';
import { EModelEndpoint, ReasoningEffort } from 'librechat-data-provider';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { TConversation } from 'librechat-data-provider';
import mockTranslation from '~/locales/en/translation.json';
import { ChatContext } from '~/Providers/ChatContext';
import Thinking from '../Thinking';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: keyof typeof mockTranslation) => mockTranslation[key],
  useSetIndexOptions: jest.requireActual('~/hooks/Conversations/useSetIndexOptions').default,
}));
jest.mock('~/Providers', () => jest.requireActual('~/Providers/ChatContext'));
jest.mock('../ModelSelectorContext', () => ({
  useModelSelectorContext: () => ({
    endpointsConfig: {
      Hermes: { type: 'custom' },
      'Hermes Adaptive': { type: 'custom' },
      Custom: {
        type: 'custom',
        customParams: {
          paramDefinitions: [
            {
              key: 'reasoning_effort',
              type: 'enum',
              component: 'dropdown',
              options: ['low', 'high'],
            },
          ],
        },
      },
    },
    mappedEndpoints: ['Hermes', 'Hermes Adaptive'].map((value) => ({
      value,
      models: [{ name: 'MiniMax-M3' }, { name: 'MiniMax-M3.1-Flash-Preview' }],
    })),
  }),
}));

const saved: TConversation = {
  createdAt: '2026-10-10T00:00:00Z',
  updatedAt: '2026-10-10T00:00:00Z',
  conversationId: 'saved-chat',
  title: 'Existing conversation',
  endpoint: 'Hermes' as EModelEndpoint,
  endpointType: EModelEndpoint.custom,
  model: 'MiniMax-M3',
  promptPrefix: 'Preserve instructions',
  maxContextTokens: 12345,
};

function Harness({
  initial = saved,
  submitting = false,
}: {
  initial?: TConversation;
  submitting?: boolean;
}) {
  const [conversation, setConversation] = useState<TConversation | null>(initial);
  const context = {
    conversation,
    setConversation,
    preset: null,
    isSubmitting: submitting,
  } as React.ContextType<typeof ChatContext>;
  return (
    <ChatContext.Provider value={context}>
      <Thinking />
      <output data-testid="conversation">{JSON.stringify(conversation)}</output>
    </ChatContext.Provider>
  );
}

async function choose(label: string) {
  const trigger = screen.getByRole('combobox');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: label });
  fireEvent.click(option);
}

describe('Thinking', () => {
  beforeAll(() => {
    HTMLElement.prototype.scrollIntoView = jest.fn();
    HTMLElement.prototype.hasPointerCapture = jest.fn(() => false);
    HTMLElement.prototype.setPointerCapture = jest.fn();
    HTMLElement.prototype.releasePointerCapture = jest.fn();
  });

  it('switches the existing M3 conversation mode without losing identity, model or context', async () => {
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Thinking: Always' })).toBeVisible();
    await choose('Adaptive');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Thinking: Adaptive' })).toBeVisible(),
    );
    const updated = JSON.parse(screen.getByTestId('conversation').textContent!);
    expect(updated).toMatchObject({ ...saved, endpoint: 'Hermes Adaptive' });
    expect(updated.reasoning_effort).toBeUndefined();
  });

  it('shows Flash medium default and writes the selected standard effort field', async () => {
    render(
      <Harness
        initial={{
          ...saved,
          model: 'MiniMax-M3.1-Flash-Preview',
          reasoning_effort: ReasoningEffort.unset,
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Thinking: Medium' })).toBeVisible();
    await choose('High');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Thinking: High' })).toBeVisible(),
    );
    const updated = JSON.parse(screen.getByTestId('conversation').textContent!);
    expect(updated).toMatchObject({
      conversationId: saved.conversationId,
      endpoint: 'Hermes',
      reasoning_effort: 'high',
    });
  });

  it('reads saved mode/effort immediately when opening a different conversation', () => {
    const { unmount } = render(
      <Harness initial={{ ...saved, endpoint: 'Hermes Adaptive' as EModelEndpoint }} />,
    );
    expect(screen.getByRole('combobox', { name: 'Thinking: Adaptive' })).toBeVisible();
    unmount();
    render(
      <Harness
        initial={{
          ...saved,
          model: 'MiniMax-M3.1-Flash-Preview',
          reasoning_effort: ReasoningEffort.max,
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Thinking: Max' })).toBeVisible();
  });

  it('preserves unavailable saved effort until the user chooses a supported value', async () => {
    render(
      <Harness
        initial={{
          ...saved,
          model: 'MiniMax-M3.1-Flash-Preview',
          reasoning_effort: ReasoningEffort.minimal,
        }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Thinking: Minimal' })).toHaveTextContent(
      'saved value unavailable',
    );
    expect(JSON.parse(screen.getByTestId('conversation').textContent!).reasoning_effort).toBe(
      'minimal',
    );
    await choose('Low');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Thinking: Low' })).toBeVisible(),
    );
  });

  it('locks the control throughout an active generation', () => {
    render(<Harness submitting />);
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('renders an unset custom default safely when its options omit Auto', async () => {
    render(
      <Harness
        initial={{ ...saved, endpoint: 'Custom' as EModelEndpoint, model: 'new-reasoner' }}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Thinking: Auto' })).toBeVisible();
    expect(
      JSON.parse(screen.getByTestId('conversation').textContent!).reasoning_effort,
    ).toBeUndefined();
    await choose('high');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Thinking: high' })).toBeVisible(),
    );
  });

  it('hides the control for unsupported models', () => {
    render(<Harness initial={{ ...saved, model: 'unrecognized-model' }} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
