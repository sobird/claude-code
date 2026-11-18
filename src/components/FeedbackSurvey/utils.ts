/** Digit-key response options shown by the feedback survey. */
export type FeedbackSurveyResponse = 'dismissed' | 'bad' | 'fine' | 'good'

/** Which survey surface produced the response; recorded in analytics. */
export type FeedbackSurveyType = 'session' | 'post_compact' | 'memory'
