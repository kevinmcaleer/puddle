import { stepForm } from '../steps';

/** The name of the step that fixes an issue, from its form, so the panel says what the Add menu says. */
export const fixName = (type: string | undefined) => (type ? (stepForm(type)?.title ?? type) : undefined);
