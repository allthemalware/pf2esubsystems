package io.github.thewhytewolf.pf2esubsystems;

import java.util.Arrays;
import java.util.Collections;

/** Runs on a plain JDK: no Android SDK, Play account or network needed. */
public final class TipPurchasesTest {
    private static final String PACKAGE = "io.github.thewhytewolf.pf2esubsystems";
    private static int assertions;

    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        TipPurchases tracker = new TipPurchases(PACKAGE);
        for (String product : TipPurchases.PRODUCTS) {
            String token = "receipt-" + product;
            check(tracker.receive(PACKAGE, Collections.singletonList(product), token, TipPurchases.Payment.PENDING)
                    == TipPurchases.Action.WAIT, "Pending payments must not be consumed or confirmed");
            check(!tracker.isConsuming(), "Pending payments cannot start consumption");
            check(!tracker.finish(token, true), "An unprocessed payment cannot trigger thanks");
            check(tracker.receive(PACKAGE, Collections.singletonList(product), token, TipPurchases.Payment.PURCHASED)
                    == TipPurchases.Action.CONSUME, "A pending payment can later complete");
            check(tracker.isConsuming(), "Completed payments require acknowledgement through consumption");
            check(tracker.receive(PACKAGE, Collections.singletonList(product), token, TipPurchases.Payment.PURCHASED)
                    == TipPurchases.Action.IGNORE, "Resume and purchase callbacks cannot consume concurrently");
            check(tracker.finish(token, true), "A successful Play consumption confirms the tip");
            check(!tracker.finish(token, true), "Duplicate confirmations cannot trigger thanks twice");
            check(tracker.receive(PACKAGE, Collections.singletonList(product), token, TipPurchases.Payment.PURCHASED)
                    == TipPurchases.Action.IGNORE, "Late callbacks cannot reprocess a confirmed purchase");
            check(tracker.receive(PACKAGE, Collections.singletonList(product), token + "-again", TipPurchases.Payment.PURCHASED)
                    == TipPurchases.Action.CONSUME, "The same tip product can be purchased again with a new receipt");
            check(tracker.finish(token + "-again", true), "A repeat tip can be confirmed");
        }

        check(tracker.receive(PACKAGE, Collections.singletonList("tip_small"), "retry", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.CONSUME, "Start confirmation");
        check(!tracker.finish("retry", false), "A failed consume cannot thank the user");
        check(!tracker.isConsuming(), "A failed attempt cannot block future retries");
        check(tracker.receive(PACKAGE, Collections.singletonList("tip_small"), "retry", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.CONSUME, "Transient failures can retry with the same token");
        check(tracker.finish("retry", true), "Retry success confirms the tip");

        check(tracker.receive("another.app", Collections.singletonList("tip_small"), "wrong-app", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Reject receipts from other apps");
        check(tracker.receive(PACKAGE, Collections.singletonList("other_product"), "wrong-product", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Never consume unrelated products");
        check(tracker.receive(PACKAGE, Arrays.asList("tip_small", "other_product"), "mixed", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Never consume a mixed or ambiguous purchase");
        check(tracker.receive(PACKAGE, Collections.emptyList(), "empty", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Reject missing product data");
        check(tracker.receive(PACKAGE, null, "missing", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Reject null product data");
        check(tracker.receive(PACKAGE, Collections.singletonList("tip_small"), "", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Reject empty receipt tokens");
        check(tracker.receive(PACKAGE, Collections.singletonList("tip_small"), null, TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.IGNORE, "Reject missing receipt tokens");
        check(tracker.receive(PACKAGE, Collections.singletonList("tip_small"), "cancelled", TipPurchases.Payment.OTHER)
                == TipPurchases.Action.IGNORE, "Cancelled or unspecified purchases must not be consumed");
        check(!tracker.isConsuming(), "Invalid purchases leave no consumption work");

        TipPurchases reopened = new TipPurchases(PACKAGE);
        check(reopened.receive(PACKAGE, Collections.singletonList("tip_large"), "unfinished-before-restart", TipPurchases.Payment.PURCHASED)
                == TipPurchases.Action.CONSUME, "A fresh app instance can recover unfinished purchases from Play");
        check(reopened.finish("unfinished-before-restart", true), "Recovered payment is confirmed");
        System.out.println(assertions + " tip purchase assertions passed");
    }
}
