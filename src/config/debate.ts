/** Hard stop so two stubborn models can't spend forever. Debates otherwise run until a concession or an unanswered decisive point. */
export const ANSWER_CAP = 30 as const;

/** How many deciding questions the backstage brief settles on. */
export const CRUX_COUNT = 3;

/** Most yes/no questions one side may fire in its rapid-fire trap chain. */
export const RAPID_FIRE_COUNT = 5 as const;

export const MODERATOR_NAME = "Morgan" as const;
