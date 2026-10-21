package io.github.thewhytewolf.pf2esubsystems;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Tracks consumption attempts, so callbacks and resume queries cannot process a tip twice. */
final class TipPurchases {
    static final List<String> PRODUCTS = Collections.unmodifiableList(
            Arrays.asList("tip_small", "tip_medium", "tip_large"));
    enum Payment { PURCHASED, PENDING, OTHER }
    enum Action { IGNORE, WAIT, CONSUME }

    private final String packageName;
    private final Set<String> consuming = new HashSet<>();
    private final Set<String> completed = new HashSet<>();

    TipPurchases(String packageName) { this.packageName = packageName; }

    Action receive(String purchasePackage, List<String> products, String token, Payment payment) {
        if (!packageName.equals(purchasePackage) || products == null || products.size() != 1
                || !PRODUCTS.contains(products.get(0)) || token == null || token.isEmpty()) {
            return Action.IGNORE;
        }
        if (payment == Payment.PENDING) return Action.WAIT;
        if (payment != Payment.PURCHASED || completed.contains(token) || !consuming.add(token)) {
            return Action.IGNORE;
        }
        return Action.CONSUME;
    }

    /** A failed confirmation remains eligible for the next Play query. */
    boolean finish(String token, boolean success) {
        if (!consuming.remove(token)) return false;
        return success && completed.add(token);
    }

    boolean isConsuming() { return !consuming.isEmpty(); }
}
