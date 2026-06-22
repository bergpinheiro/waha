exports.LoadWAHACore = () => {
  // Channels Search
  window.WAHA.WAWebNewsletterDirectorySearchJob = window.require(
    'WAWebNewsletterDirectorySearchJob',
  );
  // Channels load "preview" - fetch messages by invite code
  window.WAHA.WAWebNewsletterPreviewJob = window.require(
    'WAWebNewsletterPreviewJob',
  );
  window.WAHA.WAWebLoadNewsletterPreviewChatAction = window.require(
    'WAWebLoadNewsletterPreviewChatAction',
  );

  // Rewrite newsletter count to different number
  window.WAHA.WAWebNewsletterGatingUtils = window.require(
    'WAWebNewsletterGatingUtils',
  );
};
