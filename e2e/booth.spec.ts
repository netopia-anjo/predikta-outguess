import { test,expect,type Page } from '@playwright/test';
import { randomInt } from 'node:crypto';
async function signup(page:Page,source='phone'){
  await page.goto(source==='tv'?'/tv':'/play');
  await page.getByRole('button',{name:source==='tv'?'Tap to play here':'Start playing'}).click();
  await page.getByLabel('Full name').fill('Browser Player');
  await page.getByLabel('Mobile number (GCash)').fill(`0918${String(randomInt(10_000_000)).padStart(7,'0')}`);
  await page.getByLabel('Work email').fill('browser@example.com');
  await page.getByLabel('Company',{exact:true}).fill('Browser Co');
  await page.getByLabel('Role',{exact:true}).fill('Brand Manager');
  await page.getByRole('combobox',{name:'Industry',exact:true}).selectOption('Agency');
  await page.getByLabel('Knowing what will work before launch').check();
  await page.getByLabel('Yes',{exact:true}).check();
  await page.locator('input[name="consent"]').check();
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByRole('heading',{name:'How to play'})).toBeVisible();
  await page.getByRole('button',{name:'Choose an audience'}).click();
  await page.getByRole('button',{name:/Gen Z, Metro Manila/}).click();
}
test('phone game, enlarged ads, refresh recovery, lead interest and staff fulfillment',async({page,browser})=>{
  await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await signup(page);
  await page.getByRole('button',{name:'Enlarge A'}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Round 1 of 3',{exact:true})).toBeVisible();
  for(let i=0;i<3;i++){
    await expect(page.getByText(`Round ${i+1} of 3`,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:new RegExp(`^Ad ${i===2?'A':'B'}:`)}).click();
    await page.getByRole('button',{name:/All in/}).click();
    await page.getByRole('button',{name:/Lock in Ad/}).click();
    await expect(page.getByText('You read the crowd.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:i===2?'See my results':'Next round'}).click();
  }
  await expect(page.getByRole('heading',{name:'The Crowd Whisperer'})).toBeVisible();
  const interest=page.getByRole('button',{name:/Run a real Predikta simulation/});await interest.click();
  await expect(interest).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Claim my GCash GC'}).click();
  const code=(await page.locator('.code').innerText()).trim();expect(code).toMatch(/^[A-Z2-9]{6}$/);
  await page.screenshot({path:'test-results/phone-claim.png',fullPage:true});
  const staff=await browser.newContext({baseURL:new URL(page.url()).origin});const desk=await staff.newPage();
  await desk.goto('/staff');await desk.getByLabel('Staff PIN').fill('4321');await desk.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(desk.getByRole('heading',{name:'Confirm a reward'})).toBeVisible();
  await desk.getByLabel('Claim code').fill(code);await desk.getByRole('button',{name:'Find',exact:true}).click();
  await expect(desk.getByRole('button',{name:'Record fulfillment'})).toBeDisabled();
  await desk.getByLabel('The player’s GCash number matches the number above.').check();
  await desk.getByLabel('I have arranged the manual payout with AdSpark.').check();
  await desk.getByRole('button',{name:'Record fulfillment'}).click();
  await expect(desk.getByText('Fulfillment recorded.',{exact:true})).toBeVisible();
  await expect(page.getByText('Fulfillment recorded',{exact:true})).toBeVisible({timeout:12_000});
  const [download]=await Promise.all([desk.waitForEvent('download'),desk.getByRole('link',{name:'Export sign-ups'}).click()]);
  expect(download.suggestedFilename()).toBe('outguess-signups.csv');
  await desk.screenshot({path:'test-results/staff-desk.png',fullPage:true});
  await desk.getByRole('button',{name:'Sign out'}).click();
  await expect(desk.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await staff.close();expect(errors).toEqual([]);
});
test('landscape TV runs the game and clears the walk-up session on reload',async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await page.goto('/tv');
  await expect(page.getByRole('heading',{name:'Outguess the crowd.'}).first()).toBeVisible();
  await expect(page.getByRole('img',{name:'Scan to play on your phone'})).toBeVisible();
  await page.screenshot({path:'test-results/tv-landing.png'});
  await signup(page,'tv');await expect(page.getByText('Round 1 of 3',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('otc.token'))).toBeNull();
  await page.screenshot({path:'test-results/tv-round.png'});
  await page.reload();await expect(page.getByRole('button',{name:'Tap to play here'})).toBeVisible();
});
test('network drops recover with the same pick and reveal after refresh',async({page})=>{
  await page.setViewportSize({width:360,height:800});await signup(page);
  let failures=0;
  await page.route('**/api/game/rounds/0/lock',async route=>{if(failures++<2)await route.abort();else await route.continue();});
  await page.getByRole('button',{name:/^Ad B:/}).click();await page.getByRole('button',{name:'Lock in Ad B'}).click();
  await expect(page.getByText('You read the crowd.',{exact:true})).toBeVisible();expect(failures).toBe(3);
  await page.reload();await expect(page.getByText('You read the crowd.',{exact:true})).toBeVisible();
});
test('public APIs hide answers and reject unauthorized and cross-origin requests',async({request})=>{
  const content=await request.get('/api/content');expect(content.ok()).toBe(true);
  const raw=await content.text();for(const field of ['"winner"','"split"','"reactions"'])expect(raw).not.toContain(field);
  expect((await request.get('/api/staff/summary')).status()).toBe(401);
  expect((await request.post('/api/staff/login',{headers:{origin:'https://foreign.test'},data:{pin:'4321'}})).status()).toBe(403);
});
