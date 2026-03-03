# Chrome Web Store Submission Checklist

## Before Submission

### 1. Developer Account Setup
- [ ] Create Chrome Web Store Developer account at https://chrome.google.com/webstore/devconsole
- [ ] Pay one-time $5 registration fee
- [ ] Verify your email address

### 2. Required Assets

#### Icons (already included in extension)
- [x] 16x16 icon (icons/icon16.png)
- [x] 48x48 icon (icons/icon48.png)
- [x] 128x128 icon (icons/icon128.png)

#### Store Images (need to create)
- [ ] **Screenshots** (1280x800 or 640x400) - minimum 1, maximum 5
  - Screenshot 1: Extension popup showing paired state
  - Screenshot 2: Pairing code entry screen
  - Screenshot 3: AI controlling browser (navigation)
  - Screenshot 4: AI taking screenshot
  - Screenshot 5: AI filling form

- [ ] **Small Promo Tile** (440x280) - optional but recommended
- [ ] **Large Promo Tile** (1400x560) - optional

### 3. Store Listing Content
- [x] Extension name: "Clawku - AI Browser Control"
- [x] Short description (132 chars max)
- [x] Detailed description
- [x] Category: Productivity
- [x] Language: English

### 4. URLs Required
- [x] Privacy Policy: https://clawku.ai/privacy
- [x] Website: https://clawku.ai
- [x] Support: https://clawku.ai/docs

### 5. Privacy Policy
- [ ] Add extension-specific privacy policy section to https://clawku.ai/privacy
- [ ] Ensure it covers:
  - What data the extension collects
  - How data is transmitted and stored
  - User control and data deletion

### 6. Permission Justifications
- [x] tabs - Listed in STORE_LISTING.md
- [x] activeTab - Listed in STORE_LISTING.md
- [x] scripting - Listed in STORE_LISTING.md
- [x] storage - Listed in STORE_LISTING.md
- [x] host_permissions - Listed in STORE_LISTING.md

---

## Submission Steps

1. **Go to Chrome Web Store Developer Dashboard**
   https://chrome.google.com/webstore/devconsole

2. **Click "New Item"**

3. **Upload Extension ZIP**
   - Build fresh: `pnpm build`
   - Create ZIP from dist folder (exclude source maps for smaller size)
   ```bash
   cd dist && zip -r ../clawku-extension-store.zip . -x "*.map"
   ```

4. **Fill Store Listing**
   - Copy content from STORE_LISTING.md
   - Upload screenshots and promo images

5. **Set Privacy Practices**
   - Single purpose: "Control browser through AI assistant"
   - Permission justifications: Copy from STORE_LISTING.md
   - Data usage: Extension does not collect personal data
   - Certify: No remote code execution

6. **Submit for Review**
   - Review typically takes 1-3 business days
   - May take longer for new developers

---

## After Submission

- Monitor developer dashboard for review status
- Check email for any requested changes
- Once approved, extension will be live on Chrome Web Store
- Update Download component in platform-web with store link

---

## Common Rejection Reasons & How to Avoid

1. **Vague description** - We have detailed description explaining functionality
2. **Missing privacy policy** - Need to ensure privacy policy is accessible
3. **Excessive permissions** - All our permissions are justified and necessary
4. **Broken functionality** - Test thoroughly before submission
5. **Missing screenshots** - Need to create proper screenshots

---

## Post-Approval Updates

When updating the extension:
1. Increment version in manifest.json
2. Build and create new ZIP
3. Upload to developer dashboard
4. Updates auto-deploy to users (no re-review for minor changes)
